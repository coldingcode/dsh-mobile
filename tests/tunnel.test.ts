import { describe, expect, it } from 'vitest'
import { resolveBridgeOptions } from '../src/plugin/config.ts'
import { parseQuickTunnelUrl, startQuickTunnel } from '../src/plugin/tunnel.ts'

describe('quick tunnel', () => {
  it('extracts the public URL from cloudflared output', () => {
    expect(parseQuickTunnelUrl('2026-10-22 INF |  https://quiet-river-1234.trycloudflare.com  |')).toBe('https://quiet-river-1234.trycloudflare.com')
    expect(parseQuickTunnelUrl('no url here')).toBeUndefined()
  })

  it('extracts a URL that was split across chunks', () => {
    const first = 'INF Your quick Tunnel has been created! Visit it at https://quiet-'
    const second = 'river-1234.trycloudflare.com'
    expect(parseQuickTunnelUrl(first + second)).toBe('https://quiet-river-1234.trycloudflare.com')
  })

  it('reads tunnel mode and binary from config', () => {
    const options = resolveBridgeOptions({
      port: 0,
      workspace: process.cwd(),
      tunnel: 'quick',
      cloudflaredBinary: 'C:/tools/cloudflared.exe',
    })
    expect(options.tunnelMode).toBe('quick')
    expect(options.cloudflaredBinary).toBe('C:/tools/cloudflared.exe')
  })

  it('reads object tunnel config', () => {
    const options = resolveBridgeOptions({
      port: 0,
      workspace: process.cwd(),
      tunnel: { mode: 'quick', binary: 'C:/tools/cloudflared.exe' },
    })
    expect(options.tunnelMode).toBe('quick')
    expect(options.cloudflaredBinary).toBe('C:/tools/cloudflared.exe')
  })

  it('keeps the tunnel off by default', () => {
    const options = resolveBridgeOptions({ port: 0, workspace: process.cwd() })
    expect(options.tunnelMode).toBe('off')
  })

  it('rejects an unknown tunnel mode', () => {
    expect(() => resolveBridgeOptions({ port: 0, workspace: process.cwd(), tunnel: 'sometimes' })).toThrow(/tunnel must be/u)
  })

  it('reports a missing cloudflared binary', async () => {
    await expect(startQuickTunnel({
      binary: 'definitely-not-a-cloudflared-binary',
      localUrl: 'http://127.0.0.1:1',
      timeoutMs: 2_000,
    })).rejects.toThrow(/cloudflared could not start|cloudflared exited/u)
  })
})
