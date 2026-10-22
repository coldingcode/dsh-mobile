import { useState } from 'react'
import { ChevronDown, Copy, GitBranch, Info, TriangleAlert } from 'lucide-react'
import type { AssistantEntry, JournalEntry, NoticeEntry, SubagentEntry, UserEntry } from '../../../shared/protocol.ts'
import { copyText } from '../../../shared/protocol.ts'
import { formatTime } from '../format.ts'
import { haptic } from '../native.ts'
import { Markdown } from './Markdown.tsx'
import { ToolCard } from './ToolCard.tsx'

function UserMessage({ entry }: { entry: UserEntry }) {
  return (
    <div className="msg msg-user" data-entry-id={entry.id}>
      <div className="bubble-user">
        {entry.content.map((block, index) => {
          if (block.type === 'text') return <div className="user-text" key={index}>{block.text}</div>
          if (block.type === 'image') {
            return block.preview !== undefined
              ? <img className="user-image" src={block.preview} alt={block.alt ?? '图片'} key={index} />
              : <div className="user-image placeholder" key={index}>图片</div>
          }
          return null
        })}
        <div className="bubble-time">{formatTime(entry.ts)}</div>
      </div>
    </div>
  )
}

function AssistantMessage({ entry }: { entry: AssistantEntry }) {
  const [copied, setCopied] = useState(false)
  const reasoning = entry.content.filter((block) => block.type === 'reasoning').map((block) => block.text).join('\n').trim()
  const text = entry.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  return (
    <div className="msg msg-assistant" data-entry-id={entry.id}>
      <div className="assistant-avatar">d</div>
      <div className="assistant-main">
        {reasoning !== '' && (
          <details className="reasoning">
            <summary><span>思考过程</span><ChevronDown size={13} /></summary>
            <div>{reasoning}</div>
          </details>
        )}
        {text !== '' && <Markdown text={text} />}
        <div className="msg-tools">
          <span className="tiny muted mono">{formatTime(entry.ts)}</span>
          {entry.model !== undefined && <span className="tiny muted">{entry.model.replace('deepseek-', '')}</span>}
          <button
            className="msg-action"
            onClick={async () => {
              await copyText(text)
              setCopied(true)
              haptic('success')
              window.setTimeout(() => setCopied(false), 1400)
            }}
          >
            <Copy size={12} /> {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Notice({ entry }: { entry: NoticeEntry }) {
  const Icon = entry.tone === 'error' ? TriangleAlert : Info
  return (
    <div className={'notice notice-' + entry.tone} data-entry-id={entry.id}>
      <Icon size={13} />
      <div>
        <strong>{entry.title}</strong>
        {entry.detail !== undefined && <span>{entry.detail}</span>}
      </div>
    </div>
  )
}

function Subagent({ entry }: { entry: SubagentEntry }) {
  return (
    <div className={'subagent-card ' + entry.status} data-entry-id={entry.id}>
      <span className="subagent-icon"><GitBranch size={14} /></span>
      <div>
        <strong>{entry.label ?? (entry.status === 'running' ? '子代理运行中' : '子代理')}</strong>
        {entry.detail !== undefined && <p>{entry.detail}</p>}
      </div>
      <span className="tiny muted mono">{entry.status === 'running' ? '…' : entry.status === 'error' ? '失败' : '完成'}</span>
    </div>
  )
}

export function EntryView({ entry }: { entry: JournalEntry }) {
  if (entry.kind === 'user') return <UserMessage entry={entry} />
  if (entry.kind === 'assistant') return <AssistantMessage entry={entry} />
  if (entry.kind === 'tool') return <div className="msg msg-tool" data-entry-id={entry.id}><ToolCard entry={entry} /></div>
  if (entry.kind === 'notice') return <Notice entry={entry} />
  return <Subagent entry={entry} />
}
