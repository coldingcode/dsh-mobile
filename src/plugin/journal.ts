import { readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  AssistantEntry,
  JournalEntry,
  NoticeEntry,
  PermissionMode,
  SessionSummary,
  SubagentEntry,
  ToolEntry,
  UiBlock,
  Usage,
  UserEntry,
  ActivityItem,
} from '../shared/protocol.ts'
import { now, randomId, safeEqual, sanitizeFileName, truncate, writeJsonAtomic } from './util.ts'

interface SessionFile {
  version: 1
  session: SessionSummary
  entries: JournalEntry[]
  nextOrder: number
  truncated?: boolean
}

interface JsonObject {
  [key: string]: unknown
}

export interface DshSessionEvent {
  type: string
  seq: number
  time: number
  data?: unknown
}

export interface JournalDefaults {
  stateDir: string
  workspace: string
  provider: string
  model: string
  permissionMode: PermissionMode
}

export interface ActivityEntry extends ActivityItem {}

const MAX_ENTRIES = 600
const MAX_OUTPUT = 24_000

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function sumUsage(current: Usage, add: unknown): Usage {
  const usage = object(add)
  const next: Usage = { ...current }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'] as const) {
    const value = number(usage[key])
    if (value !== undefined) next[key] = (next[key] ?? 0) + value
  }
  return next
}

function textFromBlocks(blocks: unknown): string {
  return array(blocks)
    .map((block) => string(object(block).text) ?? '')
    .filter((text) => text !== '')
    .join('\n')
}

function toUiBlocks(blocks: unknown): UiBlock[] {
  const out: UiBlock[] = []
  for (const raw of array(blocks)) {
    const block = object(raw)
    const type = string(block.type)
    if (type === 'text') {
      const text = string(block.text)
      if (text !== undefined && text !== '') out.push({ type: 'text', text })
    } else if (type === 'reasoning') {
      const text = string(block.text)
      if (text !== undefined && text.trim() !== '') out.push({ type: 'reasoning', text })
    } else if (type === 'image') {
      const attachment = object(block.attachment)
      out.push({
        type: 'image',
        mimeType: string(attachment.mimeType) ?? string(attachment.mediaType) ?? 'image/*',
        ...(string(block.alt) !== undefined ? { alt: string(block.alt) as string } : {}),
      })
    }
  }
  return out
}

const PREVIEW_TICK = String.fromCharCode(96)
const PREVIEW_FENCE = new RegExp(PREVIEW_TICK + '{3}[\\s\\S]*?' + PREVIEW_TICK + '{3}', 'gu')
const PREVIEW_INLINE_CODE = new RegExp(PREVIEW_TICK + '([^' + PREVIEW_TICK + ']+)' + PREVIEW_TICK, 'gu')

function stripPreviewMarkdown(text: string): string {
  return text
    .replace(PREVIEW_FENCE, ' [代码] ')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/\*\*(.*?)\*\*/gu, '$1')
    .replace(PREVIEW_INLINE_CODE, '$1')
    .replace(/\[(.*?)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function previewOf(entry: JournalEntry): string | undefined {
  if (entry.kind === 'user' || entry.kind === 'assistant') {
    const text = entry.content.filter((block) => block.type === 'text').map((block) => block.text).join(' ')
    const clean = stripPreviewMarkdown(text)
    return clean === '' ? undefined : truncate(clean, 90)
  }
  if (entry.kind === 'tool') return entry.status === 'running' ? entry.title + '…' : entry.title
  if (entry.kind === 'notice') return entry.title
  if (entry.kind === 'subagent') return '子代理 ' + entry.status
  return undefined
}

const TOOL_TITLES: Record<string, string> = {
  bash: '运行命令',
  pwsh: '运行命令',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  str_replace_editor: '编辑文件',
  grep: '搜索代码',
  glob: '查找文件',
  web_search: '搜索网页',
  web_fetch: '读取网页',
  present: '交付文件',
  ask_user_question: '询问用户',
  skill: '加载技能',
  todo_write: '更新计划',
  create_goal: '创建目标',
  update_goal: '更新目标',
  get_goal: '读取目标',
  subagent: '启动子代理',
  subagent_fork: '派生上下文',
  send_message: '发送消息',
  interrupt_agent: '停止子代理',
  list_agents: '列出子代理',
  job_output: '读取任务',
  job_list: '列出任务',
  job_kill: '停止任务',
  schedule_create: '创建计划',
  schedule_list: '列出计划',
  schedule_delete: '删除计划',
  schedule_update: '更新计划',
  run_code: '执行代码',
  workspace_dependencies: '读取运行环境',
  working_directory: '切换目录',
  terminal: '终端',
  read_image: '查看图片',
  office: '处理文档',
  office_docx: '处理 Word',
  office_xlsx: '处理 Excel',
  office_pptx: '处理演示',
  office_pdf: '处理 PDF',
}

function toolTitle(name: string): string {
  return TOOL_TITLES[name] ?? name
}

function toolMeta(name: string, args: string | undefined): Record<string, string> | undefined {
  if (args === undefined) return undefined
  let parsed: JsonObject
  try {
    parsed = object(JSON.parse(args))
  } catch {
    return undefined
  }
  const meta: Record<string, string> = {}
  const command = string(parsed.command)
  const path = string(parsed.file_path) ?? string(parsed.path)
  const query = string(parsed.query) ?? string(parsed.pattern)
  const url = string(parsed.url)
  if (command !== undefined) meta.command = truncate(command, 300)
  if (path !== undefined) meta.path = truncate(path, 300)
  if (query !== undefined) meta.query = truncate(query, 300)
  if (url !== undefined) meta.url = truncate(url, 300)
  if (name === 'read' || name === 'write' || name === 'edit') {
    const description = string(parsed.description)
    if (description !== undefined) meta.description = truncate(description, 300)
  }
  return Object.keys(meta).length === 0 ? undefined : meta
}

function fallbackTitle(text: string): string {
  const clean = stripPreviewMarkdown(text)
  return clean === '' ? '新对话' : truncate(clean, 40)
}

function reasonText(reason: unknown): { tone: NoticeEntry['tone']; title: string; detail?: string } | undefined {
  const value = object(reason)
  const kind = string(value.kind)
  if (kind === undefined || kind === 'completed') return undefined
  if (kind === 'max-tokens') return { tone: 'warn', title: '输出达到上限', detail: '这一轮的回答被截断了。' }
  if (kind === 'cancelled' || kind === 'aborted') return { tone: 'info', title: '本轮已停止' }
  const error = object(value.error)
  const message = string(error.message) ?? string(value.message)
  return { tone: 'error', title: '本轮中断', ...(message !== undefined ? { detail: message } : {}) }
}

export class JournalStore {
  readonly #defaults: JournalDefaults
  readonly #dir: string
  readonly #sessions = new Map<string, SessionFile>()
  readonly #dirty = new Set<string>()
  #flushTimer: NodeJS.Timeout | undefined
  #flushChain: Promise<void> = Promise.resolve()

  constructor(defaults: JournalDefaults) {
    this.#defaults = defaults
    this.#dir = resolve(defaults.stateDir, 'sessions')
  }

  async load(): Promise<void> {
    let names: string[] = []
    try {
      names = await readdir(this.#dir)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.tmp')) continue
      try {
        const parsed = JSON.parse(await readFile(join(this.#dir, name), 'utf8')) as Partial<SessionFile>
        if (parsed.version !== 1 || parsed.session === undefined || !Array.isArray(parsed.entries)) continue
        const session = parsed.session
        if (typeof session.id !== 'string') continue
        const entries = parsed.entries.filter((entry): entry is JournalEntry => (
          entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.order === 'number'
        ))
        const nextOrder = typeof parsed.nextOrder === 'number' ? parsed.nextOrder : entries.length
        this.#sessions.set(session.id, {
          version: 1,
          session: {
            ...session,
            running: false,
            status: session.status === 'error' ? 'error' : 'idle',
            permissionMode: session.permissionMode ?? this.#defaults.permissionMode,
          },
          entries,
          nextOrder,
          ...(parsed.truncated === true ? { truncated: true } : {}),
        })
      } catch {
        /* skip corrupt session file */
      }
    }
  }

  list(): SessionSummary[] {
    return [...this.#sessions.values()]
      .map((file) => file.session)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): { session: SessionSummary; entries: JournalEntry[]; truncated?: boolean } | undefined {
    const file = this.#sessions.get(id)
    if (file === undefined) return undefined
    return {
      session: { ...file.session },
      entries: file.entries.map((entry) => structuredClone(entry)),
      ...(file.truncated === true ? { truncated: true } : {}),
    }
  }

  summary(id: string): SessionSummary | undefined {
    const file = this.#sessions.get(id)
    return file === undefined ? undefined : { ...file.session }
  }

  create(input: { id?: string; title?: string; cwd?: string } = {}): SessionSummary {
    const at = now()
    const id = input.id !== undefined && /^[A-Za-z0-9_-]{8,80}$/u.test(input.id) ? input.id : randomId()
    if (this.#sessions.has(id)) return { ...this.#sessions.get(id)!.session }
    const session: SessionSummary = {
      id,
      title: input.title !== undefined && input.title.trim() !== '' ? truncate(input.title.trim(), 80) : '新对话',
      createdAt: at,
      updatedAt: at,
      cwd: input.cwd !== undefined ? resolve(input.cwd) : this.#defaults.workspace,
      provider: this.#defaults.provider,
      model: this.#defaults.model,
      permissionMode: this.#defaults.permissionMode,
      status: 'idle',
      running: false,
      hasSdkSession: false,
      entryCount: 0,
      usage: {},
    }
    this.#sessions.set(id, { version: 1, session, entries: [], nextOrder: 0 })
    this.#markDirty(id)
    return { ...session }
  }

  rename(id: string, title: string): SessionSummary {
    const file = this.#require(id)
    const clean = title.trim()
    if (clean !== '') file.session.title = truncate(clean, 80)
    file.session.updatedAt = now()
    this.#markDirty(id)
    return { ...file.session }
  }

  setCwd(id: string, cwd: string): SessionSummary {
    const file = this.#require(id)
    file.session.cwd = cwd
    file.session.updatedAt = now()
    this.#markDirty(id)
    return { ...file.session }
  }

  delete(id: string): void {
    this.#sessions.delete(id)
    this.#dirty.delete(id)
    const filePath = join(this.#dir, sanitizeFileName(id) + '.json')
    this.#flushChain = this.#flushChain.then(async () => {
      await rm(filePath, { force: true })
      await rm(filePath + '.tmp', { force: true })
    })
  }

  markSdkSession(id: string): SessionSummary {
    const file = this.#require(id)
    file.session.hasSdkSession = true
    this.#markDirty(id)
    return { ...file.session }
  }

  setStatus(id: string, status: SessionSummary['status'], error?: string): SessionSummary {
    const file = this.#require(id)
    file.session.status = status
    file.session.running = status === 'running'
    if (error !== undefined) file.session.lastError = error
    else if (status !== 'error') delete file.session.lastError
    file.session.updatedAt = now()
    this.#markDirty(id)
    return { ...file.session }
  }

  touch(id: string): SessionSummary {
    const file = this.#require(id)
    file.session.updatedAt = now()
    this.#markDirty(id)
    return { ...file.session }
  }

  addNotice(id: string, tone: NoticeEntry['tone'], title: string, detail?: string): JournalEntry {
    return this.#insert(id, {
      kind: 'notice',
      id: randomId(),
      order: 0,
      seq: this.#require(id).session.entryCount,
      ts: now(),
      tone,
      title,
      ...(detail !== undefined ? { detail } : {}),
    })
  }

  /** Apply one durable DSH session event. Returns changed entries (inserts and updates). */
  applyEvent(sessionId: string, event: DshSessionEvent): JournalEntry[] {
    const file = this.#require(sessionId)
    const data = object(event.data)
    const changed: JournalEntry[] = []
    switch (event.type) {
      case 'session/title': {
        const title = string(data.title)
        if (title !== undefined && title.trim() !== '') {
          file.session.title = truncate(title.trim(), 80)
          file.session.updatedAt = event.time
        }
        break
      }
      case 'user/message': {
        const source = object(data.source)
        const sourceKind = string(source.kind)
        if (sourceKind !== undefined && sourceKind !== 'user') break
        const blocks = toUiBlocks(data.content)
        if (blocks.length === 0) break
        const id = string(data.id) ?? randomId()
        const text = textFromBlocks(data.content)
        const entry: UserEntry = {
          kind: 'user',
          id,
          order: 0,
          seq: event.seq,
          ts: event.time,
          content: blocks,
        }
        changed.push(this.#upsert(id, sessionId, entry))
        if (file.session.title === '新对话' && text.trim() !== '') file.session.title = fallbackTitle(text)
        break
      }
      case 'assistant/message': {
        const message = object(data.message)
        const blocks = toUiBlocks(message.content)
        const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
        const reasoning = blocks.filter((block) => block.type === 'reasoning').map((block) => block.text).join('\n')
        file.session.usage = sumUsage(file.session.usage, data.usage)
        if (text.trim() !== '' || reasoning.trim() !== '') {
          const id = string(message.id) ?? randomId()
          const source = object(message.source)
          const entry: AssistantEntry = {
            kind: 'assistant',
            id,
            order: 0,
            seq: event.seq,
            ts: event.time,
            content: blocks.filter((block) => block.type === 'text' || block.type === 'reasoning'),
            usage: object(data.usage) as Usage,
            ...(string(source.model) !== undefined ? { model: string(source.model) as string } : {}),
          }
          changed.push(this.#upsert(id, sessionId, entry))
        }
        break
      }
      case 'tool/call': {
        const callId = string(data.callId)
        if (callId === undefined) break
        const name = string(data.name) ?? 'tool'
        const args = string(data.arguments)
        const entry: ToolEntry = {
          kind: 'tool',
          id: callId,
          callId,
          order: 0,
          seq: event.seq,
          ts: event.time,
          name,
          title: toolTitle(name),
          ...(args !== undefined ? { args: truncate(args, 8000) } : {}),
          status: 'running',
          startedAt: event.time,
          ...(toolMeta(name, args) !== undefined ? { meta: toolMeta(name, args) } : {}),
        }
        changed.push(this.#upsert(callId, sessionId, entry))
        break
      }
      case 'tool/result': {
        const callId = string(data.toolCallId)
        if (callId === undefined) break
        const message = object(data.message)
        const output = truncate(textFromBlocks(message.content), MAX_OUTPUT)
        const failed = message.isError === true
        const existing = file.entries.find((entry): entry is ToolEntry => entry.kind === 'tool' && entry.id === callId)
        if (existing !== undefined) {
          existing.status = failed ? 'error' : 'done'
          existing.output = output
          existing.endedAt = event.time
          existing.seq = event.seq
          existing.ts = event.time
          changed.push(structuredClone(existing))
        } else {
          const entry: ToolEntry = {
            kind: 'tool',
            id: callId,
            callId,
            order: 0,
            seq: event.seq,
            ts: event.time,
            name: 'tool',
            title: toolTitle('tool'),
            status: failed ? 'error' : 'done',
            output,
            startedAt: event.time,
            endedAt: event.time,
          }
          changed.push(this.#upsert(callId, sessionId, entry))
        }
        break
      }
      case 'assistant/attempt': {
        const error = object(data.error)
        const message = string(error.message) ?? string(data.message) ?? '模型请求失败'
        const entry: NoticeEntry = {
          kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
          tone: 'error', title: '模型请求失败', detail: truncate(message, 1000),
        }
        changed.push(this.#insert(sessionId, entry))
        break
      }
      case 'turn/start': {
        file.session.status = 'running'
        file.session.running = true
        delete file.session.lastError
        break
      }
      case 'turn/end': {
        file.session.status = 'idle'
        file.session.running = false
        const reason = reasonText(data.reason)
        if (reason !== undefined) {
          changed.push(this.#insert(sessionId, {
            kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
            tone: reason.tone, title: reason.title, ...(reason.detail !== undefined ? { detail: reason.detail } : {}),
          }))
        }
        break
      }
      case 'approval/asked': {
        const tool = string(data.tool) ?? '敏感操作'
        const reason = string(data.reason)
        changed.push(this.#insert(sessionId, {
          kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
          tone: 'warn', title: '等待授权：' + tool,
          detail: reason ?? '手机端暂不支持审批；在 danger-full-access 模式下不会出现此步骤。',
        }))
        break
      }
      case 'approval/decided': {
        const outcome = string(data.outcome)
        if (outcome !== undefined && outcome !== 'allowed-once') {
          changed.push(this.#insert(sessionId, {
            kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
            tone: 'warn', title: '授权未通过', detail: outcome,
          }))
        }
        break
      }
      case 'plan/mode': {
        const mode = string(data.mode) ?? 'plan'
        changed.push(this.#insert(sessionId, {
          kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
          tone: 'info', title: mode === 'plan' ? '进入计划模式' : '退出计划模式',
        }))
        break
      }
      case 'compaction/end': {
        changed.push(this.#insert(sessionId, {
          kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
          tone: 'info', title: '上下文已压缩', detail: '较早的对话被折叠，以继续当前任务。',
        }))
        break
      }
      case 'working-directory/change': {
        const cwd = string(data.cwd)
        if (cwd !== undefined) file.session.cwd = cwd
        break
      }
      case 'request/context': {
        const provider = string(data.provider)
        const model = string(data.model)
        if (provider !== undefined) file.session.provider = provider
        if (model !== undefined) file.session.model = model
        break
      }
      case 'permission/preset': {
        const preset = string(data.preset)
        if (preset === 'workspace-write' || preset === 'danger-full-access') file.session.permissionMode = preset
        break
      }
      case 'deliverables/presented': {
        changed.push(this.#insert(sessionId, {
          kind: 'notice', id: randomId(), order: 0, seq: event.seq, ts: event.time,
          tone: 'info', title: '已生成交付文件', detail: '在电脑上打开 DSH 查看完整文件。',
        }))
        break
      }
      default:
        break
    }
    file.session.updatedAt = event.time > 0 ? event.time : now()
    this.#recount(sessionId)
    if (changed.length > 0) {
      const last = changed[changed.length - 1]
      if (last !== undefined) {
        const preview = previewOf(last)
        if (preview !== undefined) file.session.lastPreview = preview
      }
    }
    this.#markDirty(sessionId)
    return changed
  }

  subagentStarted(parentSessionId: string, childSessionId: string, seq: number, ts: number): JournalEntry | undefined {
    const file = this.#sessions.get(parentSessionId)
    if (file === undefined) return undefined
    const entry: SubagentEntry = {
      kind: 'subagent',
      id: 'subagent-' + childSessionId,
      order: 0,
      seq,
      ts,
      childId: childSessionId,
      status: 'running',
      label: '子代理运行中',
    }
    return this.#insert(parentSessionId, entry)
  }

  subagentFinished(parentSessionId: string, childSessionId: string, ok: boolean, detail: string | undefined, seq: number, ts: number): JournalEntry | undefined {
    const file = this.#sessions.get(parentSessionId)
    if (file === undefined) return undefined
    const id = 'subagent-' + childSessionId
    const existing = file.entries.find((entry) => entry.id === id)
    if (existing !== undefined) {
      existing.kind = 'subagent'
      const sub = existing as SubagentEntry
      sub.status = ok ? 'done' : 'error'
      sub.seq = seq
      sub.ts = ts
      if (detail !== undefined) sub.detail = truncate(detail, 2000)
      this.#markDirty(parentSessionId)
      return structuredClone(sub)
    }
    const entry: SubagentEntry = {
      kind: 'subagent', id, order: 0, seq, ts, childId: childSessionId,
      status: ok ? 'done' : 'error', label: ok ? '子代理完成' : '子代理失败',
      ...(detail !== undefined ? { detail: truncate(detail, 2000) } : {}),
    }
    return this.#insert(parentSessionId, entry)
  }

  activity(limit = 80): ActivityEntry[] {
    const items: ActivityEntry[] = []
    for (const file of this.#sessions.values()) {
      for (const entry of file.entries) {
        if (entry.kind !== 'tool') continue
        items.push({
          sessionId: file.session.id,
          sessionTitle: file.session.title,
          entry: structuredClone(entry),
        })
      }
    }
    items.sort((a, b) => {
      const aRunning = a.entry.status === 'running' ? 1 : 0
      const bRunning = b.entry.status === 'running' ? 1 : 0
      if (aRunning !== bRunning) return bRunning - aRunning
      return (b.entry.endedAt ?? b.entry.startedAt) - (a.entry.endedAt ?? a.entry.startedAt)
    })
    return items.slice(0, limit)
  }

  async flush(): Promise<void> {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = undefined
    }
    const dirty = [...this.#dirty]
    this.#dirty.clear()
    for (const id of dirty) {
      const file = this.#sessions.get(id)
      if (file === undefined) continue
      const payload: SessionFile = {
        version: 1,
        session: file.session,
        entries: file.entries,
        nextOrder: file.nextOrder,
        ...(file.truncated === true ? { truncated: true } : {}),
      }
      this.#flushChain = this.#flushChain.then(() => writeJsonAtomic(join(this.#dir, sanitizeFileName(id) + '.json'), payload))
    }
    await this.#flushChain
  }

  #require(id: string): SessionFile {
    const file = this.#sessions.get(id)
    if (file === undefined) throw new Error('session not found: ' + id)
    return file
  }

  #upsert(id: string, sessionId: string, draft: JournalEntry): JournalEntry {
    const file = this.#require(sessionId)
    const existing = file.entries.find((entry) => entry.id === id)
    if (existing !== undefined) {
      draft.order = existing.order
      Object.assign(existing, draft)
      this.#markDirty(sessionId)
      return structuredClone(existing)
    }
    return this.#insert(sessionId, draft)
  }

  #insert(sessionId: string, draft: JournalEntry): JournalEntry {
    const file = this.#require(sessionId)
    const entry = structuredClone(draft)
    if (entry.order <= 0) entry.order = ++file.nextOrder
    else file.nextOrder = Math.max(file.nextOrder, entry.order)
    file.entries.push(entry)
    if (file.entries.length > MAX_ENTRIES) {
      file.entries.splice(0, file.entries.length - MAX_ENTRIES)
      file.truncated = true
    }
    this.#recount(sessionId)
    const preview = previewOf(entry)
    if (preview !== undefined) file.session.lastPreview = preview
    this.#markDirty(sessionId)
    return structuredClone(entry)
  }

  #recount(sessionId: string): void {
    const file = this.#require(sessionId)
    file.session.entryCount = file.entries.length
  }

  #markDirty(id: string): void {
    this.#dirty.add(id)
    this.#flushTimer ??= setTimeout(() => {
      this.#flushTimer = undefined
      void this.flush().catch(() => {
        /* a failed background save must not crash the bridge */
      })
    }, 150)
    this.#flushTimer.unref?.()
  }
}
