import type { JournalEntry, UiBlock } from '../../shared/protocol.ts'

export function relativeTime(value: number, at = Date.now()): string {
  const delta = Math.max(0, at - value)
  if (delta < 45_000) return '刚刚'
  if (delta < 3_600_000) return String(Math.max(1, Math.floor(delta / 60_000))) + ' 分钟前'
  if (delta < 86_400_000) return String(Math.floor(delta / 3_600_000)) + ' 小时前'
  if (delta < 7 * 86_400_000) return String(Math.floor(delta / 86_400_000)) + ' 天前'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value)
}

export function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}

export function formatDay(value: number): string {
  const date = new Date(value)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (day === start) return '今天'
  if (day === start - 86_400_000) return '昨天'
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(value)
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return minutes + 'm ' + seconds + 's'
}

export function formatNumber(value: number | undefined): string {
  if (value === undefined) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return (value / 1000).toFixed(value < 10_000 ? 1 : 0) + 'k'
  return (value / 1_000_000).toFixed(1) + 'M'
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…'
}

export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

export function textOf(blocks: UiBlock[]): string {
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

export function previewOf(entry: JournalEntry | undefined): string {
  if (entry === undefined) return ''
  if (entry.kind === 'user' || entry.kind === 'assistant') return textOf(entry.content).replace(/\s+/gu, ' ').trim()
  if (entry.kind === 'tool') return entry.status === 'running' ? entry.title + '…' : entry.title
  if (entry.kind === 'notice') return entry.title
  if (entry.kind === 'subagent') return entry.label ?? '子代理'
  return ''
}

const PREVIEW_TICK = String.fromCharCode(96)
const PREVIEW_FENCE = new RegExp(PREVIEW_TICK + '{3}[\\s\\S]*?' + PREVIEW_TICK + '{3}', 'gu')
const PREVIEW_INLINE = new RegExp(PREVIEW_TICK + '([^' + PREVIEW_TICK + ']+)' + PREVIEW_TICK, 'gu')

export function stripPreviewMarkdown(value: string): string {
  return value
    .replace(PREVIEW_FENCE, ' [代码] ')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/\*\*(.*?)\*\*/gu, '$1')
    .replace(PREVIEW_INLINE, '$1')
    .replace(/\[(.*?)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function shortPath(value: string, max = 34): string {
  if (value.length <= max) return value
  const parts = value.replaceAll('\\', '/').split('/')
  const tail = parts.slice(-2).join('/')
  return '…/' + (tail.length > max ? tail.slice(-max) : tail)
}

export function platformName(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}
