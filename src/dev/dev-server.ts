import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MobileBridge } from '../plugin/bridge.ts'
import { resolveBridgeOptions } from '../plugin/config.ts'
import { mockRuntimeFactory } from '../plugin/mock-runtime.ts'
import type { JournalStore } from '../plugin/journal.ts'

const root = resolve(import.meta.dirname, '..', '..')
const configuredStateDir = process.env.DSH_MOBILE_STATE_DIR
const stateDir = resolve(configuredStateDir !== undefined && configuredStateDir.trim() !== '' ? configuredStateDir : resolve(root, '.tmp', 'dev-state'))
const port = Number(process.env.DSH_MOBILE_PORT ?? 47821)
const demo = process.env.DSH_MOBILE_DEMO !== '0'

const options = resolveBridgeOptions({
  port,
  bindHost: process.env.DSH_MOBILE_BIND ?? '127.0.0.1',
  workspace: process.env.DSH_MOBILE_WORKSPACE ?? root,
  stateDir,
  webDist: resolve(root, 'web-dist'),
  serverName: process.env.DSH_MOBILE_SERVER_NAME ?? 'DESKTOP-DEV',
  model: 'deepseek-flash',
  provider: 'deepseek-official',
  permissionMode: process.env.DSH_MOBILE_PERMISSION_MODE ?? 'workspace-write',
  openPairingPage: false,
  printTerminalQr: false,
  autoApprove: true,
}, { ...process.env, DSH_HOME: resolve(root, '.tmp', 'dev-home') })

const bridge = new MobileBridge(options, {
  runtimeFactory: mockRuntimeFactory,
  logger: (line) => console.log(line),
  suppressOpen: true,
})

const info = await bridge.start()
if (demo) await seed(bridge.journal)
const pairing = await fetch('http://127.0.0.1:' + String(info.port) + '/admin/state?admin=' + encodeURIComponent(bridge.adminToken)).then((response) => response.json()) as { pairCode: string }
const devToken = await pairDevBrowser(info.port, bridge.adminToken, pairing.pairCode)
await mkdir(resolve(root, '.tmp'), { recursive: true })
await writeFile(resolve(root, '.tmp', 'dev-info.json'), JSON.stringify({
  port: info.port,
  adminToken: bridge.adminToken,
  pairingUrl: info.pairingUrl,
  pairCode: pairing.pairCode,
  devToken,
  sessions: bridge.journal?.list().map((session) => session.id) ?? [],
}, null, 2) + '\n')
console.log(JSON.stringify({ port: info.port, pairingUrl: info.pairingUrl, sessions: bridge.journal?.list().length }, null, 2))
console.log('[dsh-mobile] dev token (Vite only): ' + devToken)
console.log('[dsh-mobile] Vite preview: http://127.0.0.1:5173/?token=' + encodeURIComponent(devToken))

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  await bridge.stop()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

async function pairDevBrowser(port: number, adminToken: string, pairCode: string): Promise<string> {
  const base = 'http://127.0.0.1:' + String(port)
  const receipt = await fetch(base + '/api/pair/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: pairCode,
      deviceId: 'dshm-dev-browser',
      deviceName: 'Dev Browser',
      platform: 'Web',
      appVersion: 'dev',
    }),
  }).then((response) => response.json()) as { requestId: string }
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    const status = await fetch(base + '/api/pair/request/' + encodeURIComponent(receipt.requestId)).then((response) => response.json()) as { status: string; token?: string }
    if (status.status === 'approved' && status.token !== undefined) return status.token
    if (status.status === 'denied' || status.status === 'expired') throw new Error('dev pairing failed')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120))
  }
  throw new Error('dev pairing timed out')
}

async function seed(journal: JournalStore | undefined): Promise<void> {
  if (journal === undefined || journal.list().length > 0) return
  const base = Date.now()
  const seedSession = (id: string, title: string, cwd: string): void => {
    journal.create({ id, title, cwd })
    journal.markSdkSession(id)
  }
  const ev = (id: string, type: string, seq: number, at: number, data: unknown): void => {
    journal.applyEvent(id, { type, seq, time: at, data })
  }
  const user = (text: string, idSuffix: string): Record<string, unknown> => ({
    id: 'seed-user-' + idSuffix,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  })
  const assistant = (idSuffix: string, text: string, reasoning: string): Record<string, unknown> => ({
    turn: 1, step: 2,
    message: {
      id: 'seed-assistant-' + idSuffix,
      role: 'assistant',
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
      content: [
        ...(reasoning !== '' ? [{ type: 'reasoning', text: reasoning }] : []),
        { type: 'text', text },
      ],
    },
    usage: { inputTokens: 1820, outputTokens: 286, totalTokens: 2106 },
  })

  seedSession('demo-build-fix', '修复构建失败', root)
  ev('demo-build-fix', 'user/message', 1, base - 9 * 60_000, user('跑一下测试，失败的直接修。', 'build'))
  ev('demo-build-fix', 'session/title', 2, base - 9 * 60_000 + 200, { title: '修复构建失败', source: { kind: 'fallback' } })
  ev('demo-build-fix', 'turn/start', 3, base - 9 * 60_000 + 300, { turn: 1 })
  ev('demo-build-fix', 'tool/call', 4, base - 8 * 60_000, {
    turn: 1, step: 1, callId: 'seed-call-build', name: 'pwsh',
    arguments: JSON.stringify({ command: 'pnpm test --run', description: 'Run the test suite' }),
  })
  ev('demo-build-fix', 'tool/result', 5, base - 8 * 60_000 + 4200, {
    turn: 1, step: 1, toolCallId: 'seed-call-build',
    message: {
      role: 'tool', toolCallId: 'seed-call-build', isError: false,
      content: [{ type: 'text', text: ' RUN  v2.1.9\n\n ✓ tests/pairing.test.ts (12 tests) 38ms\n ✓ tests/journal.test.ts (8 tests) 21ms\n\n Test Files  2 passed (2)\n      Tests  20 passed (20)\n   Duration  3.42s\n' }],
    },
    meta: { cwd: root },
  })
  ev('demo-build-fix', 'assistant/message', 6, base - 8 * 60_000 + 6000, assistant('build', [
    '## 测试已经通过',
    '',
    '当前基线是绿的，20 个测试全部通过。接下来建议把配对接口的边界补上：',
    '',
    '- 配对码过期后的错误要可读',
    '- 同一个设备重复发起请求时，旧请求应该被替换',
    '- 设备令牌哈希只写磁盘一次，避免频繁 I/O',
    '',
    '建议先加一个小的配对测试：',
    '',
    '    const receipt = await bridge.pairing.createRequest(body, ip)',
    '    expect(receipt.verificationCode).toMatch(/^[0-9]{6}$/)',
    '',
    '需要我直接开始改吗？',
  ].join('\n'), '先确认测试基线，再给出最小改动方案。'))
  ev('demo-build-fix', 'turn/end', 7, base - 8 * 60_000 + 6200, { turn: 1, reason: { kind: 'completed' } })

  seedSession('demo-pairing', '重构配对流程', root)
  ev('demo-pairing', 'user/message', 1, base - 3 * 60_000, user('帮我检查配对流程还有哪些边界情况。', 'pair'))
  ev('demo-pairing', 'session/title', 2, base - 3 * 60_000 + 200, { title: '重构配对流程', source: { kind: 'fallback' } })
  ev('demo-pairing', 'turn/start', 3, base - 3 * 60_000 + 300, { turn: 1 })
  ev('demo-pairing', 'tool/call', 4, base - 70_000, {
    turn: 1, step: 1, callId: 'seed-call-pairing', name: 'grep',
    arguments: JSON.stringify({ pattern: 'pair/request', path: 'src/plugin' }),
  })
  journal.setStatus('demo-pairing', 'running')

  seedSession('demo-design', 'iOS 26 玻璃质感', root)
  ev('demo-design', 'user/message', 1, base - 2 * 60 * 60_000, user('对比一下 iOS 26 的 Liquid Glass 和普通毛玻璃，给我一个 CSS 方案。', 'design'))
  ev('demo-design', 'session/title', 2, base - 2 * 60 * 60_000 + 300, { title: 'iOS 26 玻璃质感', source: { kind: 'fallback' } })
  ev('demo-design', 'turn/start', 3, base - 2 * 60 * 60_000 + 400, { turn: 1 })
  ev('demo-design', 'tool/call', 4, base - 2 * 60 * 60_000 + 800, {
    turn: 1, step: 1, callId: 'seed-call-design', name: 'read',
    arguments: JSON.stringify({ file_path: 'docs/design-notes.md' }),
  })
  ev('demo-design', 'tool/result', 5, base - 2 * 60 * 60_000 + 1200, {
    turn: 1, step: 1, toolCallId: 'seed-call-design',
    message: { role: 'tool', toolCallId: 'seed-call-design', isError: false, content: [{ type: 'text', text: '# Liquid Glass notes\n\n- 折射 + 高光 + 边缘\n- 圆角连续\n- 避免厚背景\n' }] },
    meta: { cwd: root },
  })
  ev('demo-design', 'assistant/message', 6, base - 2 * 60 * 60_000 + 1500, assistant('design', [
    'Liquid Glass 的关键不是“更模糊”，而是**三层叠加**：',
    '',
    '1. **折射层**：backdrop-filter: blur(30px) saturate(180%)',
    '2. **高光层**：左上角的白色镜面渐变',
    '3. **边缘层**：1px 半透明描边 + 内侧 1px 高光',
    '',
    '    .glass {',
    '      background: linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.04));',
    '      border: 1px solid rgba(255,255,255,.14);',
    '      box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 24px 60px rgba(0,0,0,.35);',
    '      backdrop-filter: blur(30px) saturate(180%);',
    '    }',
    '',
    '在手机上要让圆角保持连续，建议 26–32px，并且不要在玻璃内部再叠一层厚背景。',
  ].join('\n'), ''))
  ev('demo-design', 'turn/end', 7, base - 2 * 60 * 60_000 + 1700, { turn: 1, reason: { kind: 'completed' } })

  seedSession('demo-release', '整理发布说明', root)
  ev('demo-release', 'user/message', 1, base - 4 * 60 * 60_000, user('把这一版的 iOS 自签安装步骤整理成给用户看的说明。', 'release'))
  ev('demo-release', 'session/title', 2, base - 4 * 60 * 60_000 + 300, { title: '整理发布说明', source: { kind: 'fallback' } })
  ev('demo-release', 'turn/start', 3, base - 4 * 60 * 60_000 + 400, { turn: 1 })
  ev('demo-release', 'assistant/message', 4, base - 4 * 60 * 60_000 + 1200, assistant('release', [
    '发布说明可以分成三段：',
    '',
    '1. **这个版本是什么** — 不是 App Store 版本，而是 GitHub Actions 构建的自托管壳。',
    '2. **怎么装** — 添加 AltStore Source，或者下载未签名 IPA 用 SideStore 重签。',
    '3. **怎么信任** — 首次打开前在「设置 → 通用 → VPN 与设备管理」里信任证书。',
    '',
    '把这三段放在 Release 页面顶部，安装链接放二维码，转化会更高。',
  ].join('\n'), '先想清楚用户会在哪一步卡住。'))
  ev('demo-release', 'turn/end', 5, base - 4 * 60 * 60_000 + 1400, { turn: 1, reason: { kind: 'completed' } })

  await journal.flush()
}
