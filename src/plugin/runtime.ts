import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { dirname, join } from 'node:path'
import type { PermissionMode, RuntimeStatus } from '../shared/protocol.ts'
import { BridgeError } from '../shared/protocol.ts'

export type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface RuntimeCallbacks {
  onSessionEvent: (sessionId: string, event: { type: string; seq: number; time: number; data?: unknown }) => void
  onSessionStatus: (sessionId: string, status: 'running' | 'idle') => void
  onSubagentStarted: (parentSessionId: string, childSessionId: string) => void
  onSubagentFinished: (payload: {
    provider?: string
    agentId: string
    parentSessionId: string
    childSessionId: string
    status: 'ok' | 'error'
    stopReason?: string
    lastAssistantMessage?: string[]
  }) => void
  onStatus: (status: RuntimeStatus) => void
  onLog: (line: string, stream: 'stdout' | 'stderr') => void
}

export interface RuntimeOptions {
  workspace: string
  provider: string
  model: string
  permissionMode: PermissionMode
  sdkCommand?: string
  sdkArgs?: string[]
  env?: NodeJS.ProcessEnv
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface Invocation {
  command: string
  args: string[]
  shell: boolean
  env: NodeJS.ProcessEnv
  source: string
}

const MAX_LOG_LINES = 40

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Find the packaged DSH CLI next to the running Electron executable. */
function packagedCliCandidates(): string[] {
  const candidates: string[] = []
  const explicit = process.env.DSH_MOBILE_CLI ?? process.env.DSH_CLI_PATH
  if (explicit !== undefined && explicit !== '') candidates.push(explicit)
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const roots = [resources, join(dirname(process.execPath), 'resources')].filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  for (const root of roots) {
    candidates.push(join(root, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
    candidates.push(join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
  }
  const argv1 = process.argv[1]
  if (argv1 !== undefined && argv1.endsWith('cli.js')) candidates.push(argv1)
  return [...new Set(candidates)]
}

/** Resolve how to start a DSH SDK stdio runtime. */
export function resolveInvocation(options: RuntimeOptions): Invocation {
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    DSH_PERMISSION_MODE: options.permissionMode,
    DSH_MOBILE_RUNTIME: '1',
  }
  for (const key of ['DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL', 'DSH_PROFILE', 'DSH_PROFILE_DIR']) delete baseEnv[key]
  if (options.sdkCommand !== undefined) {
    const args = options.sdkArgs ?? ['--profile', 'sdk']
    const command = options.sdkCommand
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command)
    if (process.versions.electron !== undefined && !/node(\.exe)?$/iu.test(command)) baseEnv.ELECTRON_RUN_AS_NODE = '1'
    return { command, args, shell, env: baseEnv, source: 'config' }
  }
  for (const candidate of packagedCliCandidates()) {
    if (!existsSync(candidate)) continue
    const electron = process.versions.electron !== undefined
    return {
      command: process.execPath,
      args: [...(electron ? ['--expose-internals'] : []), candidate, '--profile', 'sdk'],
      shell: false,
      env: { ...baseEnv, ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      source: 'packaged',
    }
  }
  return {
    command: process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
    args: ['--profile', 'sdk'],
    shell: process.platform === 'win32',
    env: baseEnv,
    source: 'path',
  }
}

/**
 * One DSH SDK runtime over stdio JSON-RPC. The SDK protocol is the stable
 * contract; this class owns process lifecycle, request correlation and the
 * two notification channels the bridge consumes.
 */
export class SdkRuntime {
  readonly #options: RuntimeOptions
  readonly #callbacks: RuntimeCallbacks
  #child: ChildProcessWithoutNullStreams | undefined
  #pending = new Map<string, PendingRequest>()
  #buffer = ''
  #decoder = new StringDecoder('utf8')
  #status: RuntimeStatus = { state: 'stopped' }
  #startTask: Promise<void> | undefined
  #opened = new Set<string>()
  #initialized = false
  #stopping = false
  #logLines: string[] = []
  #requestSeq = 0

  constructor(options: RuntimeOptions, callbacks: RuntimeCallbacks) {
    this.#options = options
    this.#callbacks = callbacks
  }

  get status(): RuntimeStatus {
    return { ...this.#status }
  }

  get openedSessions(): string[] {
    return [...this.#opened]
  }

  setStatus(status: RuntimeStatus): void {
    this.#status = status
    this.#callbacks.onStatus({ ...status })
  }

  async start(): Promise<void> {
    if (this.#initialized && this.#child !== undefined && this.#child.exitCode === null) return
    this.#startTask ??= this.#startInternal().finally(() => {
      this.#startTask = undefined
    })
    return this.#startTask
  }

  async #startInternal(): Promise<void> {
    if (this.#child !== undefined) await this.#terminateChild()
    this.setStatus({ state: 'starting' })
    const invocation = resolveInvocation(this.#options)
    this.#callbacks.onLog('runtime: ' + invocation.source + ' ' + invocation.command + ' ' + invocation.args.join(' '), 'stdout')
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: this.#options.workspace,
        env: invocation.env,
        shell: invocation.shell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus({ state: 'error', message })
      throw new BridgeError(503, 'runtime-spawn-failed', '无法启动本机 DSH 运行时：' + message)
    }
    this.#child = child
    child.stdout.on('data', (chunk: Buffer) => this.#onStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u)) {
        if (line.trim() === '') continue
        this.#pushLog(line)
        this.#callbacks.onLog(line, 'stderr')
      }
    })
    child.on('error', (error) => {
      this.#failAll(error)
      this.setStatus({ state: 'error', message: error.message })
    })
    child.on('exit', (code, signal) => {
      this.#child = undefined
      this.#initialized = false
      this.#opened.clear()
      const message = 'DSH 运行时已退出（code ' + String(code) + (signal !== null ? ', signal ' + signal : '') + '）'
      this.#failAll(new Error(message))
      if (!this.#stopping) {
        const detail = this.#logLines.slice(-8).join('\n')
        this.setStatus({ state: 'error', message: message + (detail !== '' ? '\n' + detail : '') })
      } else {
        this.setStatus({ state: 'stopped' })
      }
      this.#stopping = false
    })

    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('DSH runtime did not start within 45s')), 45_000)
      const onError = (error: Error) => {
        clearTimeout(timer)
        rejectReady(error)
      }
      child.once('spawn', () => {
        clearTimeout(timer)
        resolveReady()
      })
      child.once('error', onError)
    })
    await ready
    let result: unknown
    try {
      result = await this.request('initialize', {
        cwd: this.#options.workspace,
        provider: this.#options.provider,
        model: this.#options.model,
      }, 90_000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus({ state: 'error', message: 'DSH 运行时握手失败：' + message })
      throw error
    }
    const info = asRecord(asRecord(result).serverInfo)
    if (asString(info.name) !== 'deepseek-harness-sdk-runtime') {
      this.setStatus({ state: 'error', message: 'DSH 运行时返回了未知身份' })
      throw new BridgeError(502, 'runtime-handshake-failed', 'DSH 运行时握手失败：返回了未知身份')
    }
    this.#initialized = true
    this.setStatus({ state: 'ready' })
  }

  async prompt(sessionId: string, blocks: PromptBlock[], resume: boolean): Promise<string> {
    await this.start()
    if (resume && !this.#opened.has(sessionId)) {
      await this.request('session/resume', { sessionId }, 60_000)
      this.#opened.add(sessionId)
    }
    const result = asRecord(await this.request('session/prompt', { sessionId, contentBlocks: blocks }, 120_000))
    this.#opened.add(sessionId)
    const messageId = asString(result.messageId)
    if (messageId === undefined) throw new BridgeError(502, 'runtime-prompt-failed', 'DSH 运行时没有返回消息 ID')
    return messageId
  }

  async setWorkingDirectory(sessionId: string, path: string): Promise<string> {
    await this.start()
    const result = asRecord(await this.request('session/working-directory/set', { sessionId, path }, 30_000))
    this.#opened.add(sessionId)
    return asString(result.cwd) ?? path
  }

  /**
   * The SDK has no per-turn cancel. Restarting the child is the only correct
   * way to interrupt an in-flight turn; resume every previously opened session
   * so their durable logs are repaired and future prompts continue.
   */
  async restart(): Promise<void> {
    const previouslyOpened = [...this.#opened]
    this.#stopping = true
    await this.#terminateChild()
    this.#stopping = false
    this.setStatus({ state: 'starting', message: '正在重启运行时' })
    await this.start()
    for (const sessionId of previouslyOpened) {
      try {
        await this.request('session/resume', { sessionId }, 45_000)
        this.#opened.add(sessionId)
      } catch (error) {
        this.#callbacks.onLog('resume after restart failed for ' + sessionId + ': ' + (error instanceof Error ? error.message : String(error)), 'stderr')
      }
    }
    this.setStatus({ state: 'ready' })
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#child !== undefined) {
      try {
        await this.request('shutdown', {}, 5000)
      } catch {
        /* fall through to kill */
      }
    }
    await this.#terminateChild()
    this.#stopping = false
    this.#initialized = false
    this.#opened.clear()
    this.setStatus({ state: 'stopped' })
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const child = this.#child
    if (child === undefined || child.stdin.destroyed) {
      return Promise.reject(new BridgeError(503, 'runtime-not-running', 'DSH 运行时尚未启动'))
    }
    const id = 'dshm-' + (++this.#requestSeq).toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        rejectPromise(new Error('DSH 运行时请求超时：' + method))
      }, timeoutMs)
      timer.unref?.()
      this.#pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      try {
        child.stdin.write(frame, 'utf8')
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  #onStdout(chunk: Buffer): void {
    this.#buffer += this.#decoder.write(chunk)
    for (;;) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.#buffer.slice(0, newline).trim()
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line === '') continue
      this.#handleLine(line)
    }
  }

  #handleLine(line: string): void {
    let frame: Record<string, unknown>
    try {
      frame = asRecord(JSON.parse(line))
    } catch {
      this.#pushLog('[non-json stdout] ' + line)
      this.#callbacks.onLog('[non-json stdout] ' + line, 'stdout')
      return
    }
    const id = asString(frame.id)
    const method = asString(frame.method)
    if (id !== undefined && method === undefined) {
      const pending = this.#pending.get(id)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      this.#pending.delete(id)
      const error = asRecord(frame.error)
      if (frame.error !== undefined) {
        const message = asString(error.message) ?? 'runtime request failed'
        pending.reject(new Error(message))
      } else {
        pending.resolve(frame.result)
      }
      return
    }
    if (method === undefined) return
    const params = asRecord(frame.params)
    switch (method) {
      case 'session.event': {
        const sessionId = asString(params.sessionId)
        const event = asRecord(params.event)
        const type = asString(event.type)
        const seq = typeof event.seq === 'number' ? event.seq : 0
        const time = typeof event.time === 'number' ? event.time : Date.now()
        if (sessionId !== undefined && type !== undefined) {
          this.#callbacks.onSessionEvent(sessionId, { type, seq, time, data: event.data })
        }
        break
      }
      case 'session.status': {
        const sessionId = asString(params.sessionId)
        const status = asString(params.status)
        if (sessionId !== undefined && (status === 'running' || status === 'idle')) this.#callbacks.onSessionStatus(sessionId, status)
        break
      }
      case 'subagent.started': {
        const parent = asString(params.parentSessionId)
        const child = asString(params.childSessionId)
        if (parent !== undefined && child !== undefined) this.#callbacks.onSubagentStarted(parent, child)
        break
      }
      case 'subagent.finished': {
        const parent = asString(params.parentSessionId)
        const child = asString(params.childSessionId)
        if (parent !== undefined && child !== undefined) {
          const rawMessage = params.lastAssistantMessage
          const lastAssistantMessage = Array.isArray(rawMessage) ? rawMessage.filter((entry): entry is string => typeof entry === 'string') : undefined
          this.#callbacks.onSubagentFinished({
            ...(asString(params.provider) !== undefined ? { provider: asString(params.provider) as string } : {}),
            agentId: asString(params.agentId) ?? child,
            parentSessionId: parent,
            childSessionId: child,
            status: params.status === 'ok' ? 'ok' : 'error',
            ...(asString(params.stopReason) !== undefined ? { stopReason: asString(params.stopReason) as string } : {}),
            ...(lastAssistantMessage !== undefined ? { lastAssistantMessage } : {}),
          })
        }
        break
      }
      default:
        break
    }
  }

  #pushLog(line: string): void {
    this.#logLines.push(line)
    if (this.#logLines.length > MAX_LOG_LINES) this.#logLines.shift()
  }

  #failAll(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.#pending.delete(id)
    }
  }

  async #terminateChild(): Promise<void> {
    const child = this.#child
    this.#child = undefined
    this.#initialized = false
    this.#failAll(new Error('DSH runtime terminated'))
    if (child === undefined) return
    if (child.exitCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolveDone) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolveDone()
      }, 4000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolveDone()
      })
    })
  }
}
