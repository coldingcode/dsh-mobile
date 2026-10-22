import { spawn } from 'node:child_process'

/** Hand one URL to the platform browser without a shell on POSIX. */
export function openExternal(url: string): void {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    /* opening the browser is best-effort */
  }
}
