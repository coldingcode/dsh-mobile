import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { MobileBridge } from '../src/plugin/bridge.ts'
import { resolveBridgeOptions } from '../src/plugin/config.ts'
import { mockRuntimeFactory } from '../src/plugin/mock-runtime.ts'

let dir = ''
let bridge: MobileBridge
let base = ''
let token = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dshm-bridge-'))
  const web = join(dir, 'web-dist')
  await mkdir(web, { recursive: true })
  await writeFile(join(web, 'index.html'), '<!doctype html><title>test</title>')
  const options = resolveBridgeOptions({
    port: 0,
    bindHost: '127.0.0.1',
    workspace: dir,
    stateDir: join(dir, 'state'),
    webDist: web,
    serverName: 'Bridge Test',
    openPairingPage: false,
    printTerminalQr: false,
    autoApprove: true,
    pairingCodeTtlSeconds: 600,
  })
  bridge = new MobileBridge(options, {
    runtimeFactory: mockRuntimeFactory,
    logger: () => {},
    suppressOpen: true,
  })
  const info = await bridge.start()
  base = 'http://127.0.0.1:' + String(info.port)
  const admin = bridge.adminToken
  const state = await fetch(base + '/admin/state?admin=' + encodeURIComponent(admin)).then((response) => response.json()) as { pairCode: string }
  const receipt = await fetch(base + '/api/pair/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: state.pairCode, deviceId: 'test', deviceName: 'Test iPhone', platform: 'iOS' }),
  }).then((response) => response.json()) as { requestId: string }
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const status = await fetch(base + '/api/pair/request/' + encodeURIComponent(receipt.requestId)).then((response) => response.json()) as { status: string; token?: string }
    if (status.status === 'approved' && status.token !== undefined) {
      token = status.token
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  expect(token).not.toBe('')
})

afterEach(async () => {
  await bridge.stop()
  await rm(dir, { recursive: true, force: true })
})

describe('MobileBridge', () => {
  it('serves health without authentication', async () => {
    const health = await fetch(base + '/api/health').then((response) => response.json()) as { ok: boolean; app: string }
    expect(health.ok).toBe(true)
    expect(health.app).toBe('dsh-mobile')
  })

  it('requires a device token for bootstrap', async () => {
    const response = await fetch(base + '/api/bootstrap')
    expect(response.status).toBe(401)
  })

  it('creates a session, prompts the mock runtime and records activity', async () => {
    const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' }
    const created = await fetch(base + '/api/sessions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ title: 'Bridge smoke', cwd: dir }),
    }).then((response) => response.json()) as { session: { id: string } }
    const prompt = await fetch(base + '/api/sessions/' + created.session.id + '/prompt', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ contentBlocks: [{ type: 'text', text: '运行测试' }] }),
    }).then((response) => response.json()) as { ok: boolean }
    expect(prompt.ok).toBe(true)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3200))
    const detail = await fetch(base + '/api/sessions/' + created.session.id, { headers: auth }).then((response) => response.json()) as { entries: Array<{ kind: string }> }
    expect(detail.entries.map((entry) => entry.kind)).toContain('user')
    expect(detail.entries.map((entry) => entry.kind)).toContain('tool')
    expect(detail.entries.map((entry) => entry.kind)).toContain('assistant')
    const activity = await fetch(base + '/api/activity', { headers: auth }).then((response) => response.json()) as { items: unknown[] }
    expect(activity.items.length).toBeGreaterThan(0)
  })

  it('keeps admin endpoints local even behind a tunnel header', async () => {
    const response = await fetch(base + '/admin/state?admin=' + encodeURIComponent(bridge.adminToken), {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })
    expect(response.status).toBe(403)
    const page = await fetch(base + '/pair?admin=' + encodeURIComponent(bridge.adminToken), {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
    expect(page.status).toBe(403)
  })

  it('opens an authenticated websocket and sends a hello frame', async () => {
    const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' }
    const ticket = await fetch(base + '/api/ws-ticket', { method: 'POST', headers: auth, body: '{}' }).then((response) => response.json()) as { ticket: string }
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws?ticket=' + encodeURIComponent(ticket.ticket))
    const message = await new Promise<string>((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => rejectMessage(new Error('websocket hello timeout')), 4000)
      socket.on('message', (data) => {
        clearTimeout(timer)
        resolveMessage(String(data))
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        rejectMessage(error)
      })
    })
    const parsed = JSON.parse(message) as { type: string }
    expect(parsed.type).toBe('hello')
    socket.close()
  })
})
