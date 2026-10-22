import { spawn, type ChildProcess } from 'node:child_process'

export interface QuickTunnelOptions {
  binary: string
  localUrl: string
  timeoutMs?: number
  logger?: (line: string) => void
}

export interface QuickTunnelHandle {
  url: string
  stop: () => Promise<void>
}

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/iu

/** Extract the public quick-tunnel URL from cloudflared output. */
export function parseQuickTunnelUrl(text: string): string | undefined {
  return QUICK_TUNNEL_URL.exec(text)?.[0]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Start a Cloudflare quick tunnel for the local bridge. The tunnel is an
 * optional relay: it lets a phone reach the computer from outside its LAN
 * without opening an inbound port. Cloudflare terminates TLS and relays
 * plaintext HTTP, so the pairing token remains the application-level guard.
 */
export async function startQuickTunnel(options: QuickTunnelOptions): Promise<QuickTunnelHandle> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const child: ChildProcess = spawn(
    options.binary,
    ['tunnel', '--url', options.localUrl, '--no-autoupdate', '--protocol', 'http2'],
    {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  let output = ''
  let settled = false
  let exited = false

  const exitPromise = new Promise<void>((resolveExit) => {
    child.once('exit', () => {
      exited = true
      resolveExit()
    })
  })

  const startPromise = new Promise<string>((resolveStart, rejectStart) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      const tail = output.split(/\r?\n/u).filter((line) => line.trim() !== '').slice(-8).join('\n')
      rejectStart(new Error('cloudflared quick tunnel did not become ready in time' + (tail !== '' ? '\n' + tail : '')))
    }, timeoutMs)
    timer.unref?.()

    let discovered: string | undefined
    let registered = false
    let graceTimer: NodeJS.Timeout | undefined
    let graceExpired = false

    const finishIfReady = (): void => {
      if (settled || discovered === undefined) return
      if (!registered && !graceExpired) return
      settled = true
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      resolveStart(discovered)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      rejectStart(error)
    }

    child.on('error', (error) => {
      fail(new Error('cloudflared could not start: ' + error.message))
    })

    const consume = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output += text
      for (const line of text.split(/\r?\n/u)) {
        if (line.trim() !== '') options.logger?.(line.trim())
      }
      if (settled) return
      if (/Registered tunnel connection/iu.test(text)) {
        registered = true
        finishIfReady()
      }
      if (discovered === undefined) {
        discovered = parseQuickTunnelUrl(output)
        if (discovered !== undefined) {
          graceTimer = setTimeout(() => {
            graceExpired = true
            finishIfReady()
          }, 5_000)
          graceTimer.unref?.()
          finishIfReady()
        }
      }
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)

    child.on('exit', (code, signal) => {
      if (!settled) {
        const tail = output.split(/\r?\n/u).filter((line) => line.trim() !== '').slice(-8).join('\n')
        fail(new Error('cloudflared exited before publishing a URL (code ' + String(code) + (signal !== null ? ', signal ' + signal : '') + ')' + (tail !== '' ? '\n' + tail : '')))
      }
    })
  })

  const url = await startPromise

  return {
    url,
    stop: async () => {
      if (exited) return
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      await Promise.race([exitPromise, sleep(3_000)])
      if (!exited) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    },
  }
}
