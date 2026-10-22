import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JournalStore } from '../src/plugin/journal.ts'

let dir = ''
let journal: JournalStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dshm-journal-'))
  journal = new JournalStore({
    stateDir: dir,
    workspace: process.cwd(),
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    permissionMode: 'workspace-write',
  })
  await journal.load()
})

afterEach(async () => {
  await journal.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('JournalStore', () => {
  it('normalizes a turn with a tool call and strips markdown previews', () => {
    const session = journal.create({ id: 'session-test-0001', cwd: process.cwd() })
    expect(session.id).toBe('session-test-0001')
    journal.applyEvent(session.id, {
      type: 'user/message', seq: 1, time: 1_000,
      data: { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '## 检查 **构建** 失败' }] },
    })
    journal.applyEvent(session.id, {
      type: 'tool/call', seq: 2, time: 1_100,
      data: { callId: 'c1', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm test' }) },
    })
    journal.applyEvent(session.id, {
      type: 'assistant/message', seq: 3, time: 1_200,
      data: {
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '已经修复。' }], source: { model: 'deepseek-flash' } },
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    })
    journal.applyEvent(session.id, {
      type: 'tool/result', seq: 4, time: 1_300,
      data: { toolCallId: 'c1', message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'ok' }] } },
    })
    const detail = journal.get(session.id)
    expect(detail?.entries.map((entry) => entry.kind)).toEqual(['user', 'tool', 'assistant'])
    const tool = detail?.entries.find((entry) => entry.kind === 'tool')
    expect(tool?.status).toBe('done')
    expect(tool?.output).toBe('ok')
    expect(detail?.session.title).toBe('检查 构建 失败')
    expect(detail?.session.lastPreview).not.toContain('##')
    expect(detail?.session.lastPreview).not.toContain('**')
    expect(detail?.session.usage.inputTokens).toBe(10)
  })

  it('persists sessions and reloads them as idle', async () => {
    const session = journal.create({ id: 'session-test-0002', title: 'Persisted' })
    journal.applyEvent(session.id, { type: 'turn/start', seq: 1, time: 2_000, data: {} })
    journal.setStatus(session.id, 'running')
    await journal.flush()
    const reloaded = new JournalStore({
      stateDir: dir,
      workspace: process.cwd(),
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      permissionMode: 'workspace-write',
    })
    await reloaded.load()
    const summary = reloaded.summary(session.id)
    expect(summary?.title).toBe('Persisted')
    expect(summary?.running).toBe(false)
    expect(summary?.status).toBe('idle')
  })

  it('tracks activity and errors', () => {
    const session = journal.create({ id: 'session-test-0003' })
    journal.applyEvent(session.id, { type: 'tool/call', seq: 1, time: 3_000, data: { callId: 'x', name: 'read', arguments: '{}' } })
    journal.applyEvent(session.id, { type: 'tool/result', seq: 2, time: 3_100, data: { toolCallId: 'x', message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'missing' }] } } })
    expect(journal.activity()[0]?.entry.status).toBe('error')
    journal.addNotice(session.id, 'warn', '注意', '示例')
    expect(journal.get(session.id)?.entries.some((entry) => entry.kind === 'notice')).toBe(true)
  })

  it('removes the persisted session file', async () => {
    const session = journal.create({ id: 'session-test-0004', title: 'To remove' })
    await journal.flush()
    journal.delete(session.id)
    await journal.flush()
    const reloaded = new JournalStore({
      stateDir: dir,
      workspace: process.cwd(),
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      permissionMode: 'workspace-write',
    })
    await reloaded.load()
    expect(reloaded.summary(session.id)).toBeUndefined()
  })
})
