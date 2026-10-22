import { useState } from 'react'
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react'
import type { ToolEntry } from '../../../shared/protocol.ts'
import { copyText } from '../../../shared/protocol.ts'
import { formatDuration, stripAnsi, truncate } from '../format.ts'
import { haptic } from '../native.ts'
import { toolIcon } from './ToolIcon.ts'

interface Props {
  entry: ToolEntry
  compact?: boolean
  defaultOpen?: boolean
}

export function ToolCard({ entry, compact = false, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen || entry.status === 'error')
  const [copied, setCopied] = useState(false)
  const Icon = toolIcon(entry.name)
  const duration = entry.endedAt !== undefined ? formatDuration(entry.endedAt - entry.startedAt) : undefined
  const output = entry.output !== undefined ? stripAnsi(entry.output) : ''
  const meta = entry.meta
  const metaLine = meta?.command ?? meta?.query ?? meta?.path ?? meta?.url ?? (entry.args !== undefined ? truncate(entry.args.replace(/\s+/gu, ' '), 100) : '')
  const hasOutput = output.trim() !== ''

  return (
    <div className={'tool-card' + (compact ? ' compact' : '') + (entry.status === 'running' ? ' running' : '') + (entry.status === 'error' ? ' failed' : '')}>
      <button
        className="tool-head"
        onClick={() => {
          haptic('light')
          setOpen((value) => !value)
        }}
        aria-expanded={open}
      >
        <span className="tool-icon"><Icon size={15} strokeWidth={1.9} /></span>
        <span className="tool-main">
          <span className="tool-title-row">
            <span className="tool-title">{entry.title}</span>
            <span className={'tool-status ' + entry.status}>
              {entry.status === 'running' ? <Loader2 size={11} className="spin" /> : entry.status === 'error' ? <X size={11} /> : <Check size={11} />}
              {entry.status === 'running' ? '运行中' : entry.status === 'error' ? '失败' : '完成'}
            </span>
          </span>
          {metaLine !== '' && <span className="tool-meta mono">{metaLine}</span>}
        </span>
        <span className="tool-trail">
          {duration !== undefined && <span className="tiny muted mono">{duration}</span>}
          {hasOutput && <ChevronDown size={15} className={'chev' + (open ? ' open' : '')} />}
        </span>
      </button>
      {entry.status === 'running' && <div className="tool-progress" />}
      {open && hasOutput && (
        <div className="tool-output">
          <div className="tool-output-bar">
            <span className="tiny muted">输出</span>
            <button
              className="tiny copy-mini"
              onClick={async () => {
                await copyText(output)
                setCopied(true)
                haptic('success')
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              <Copy size={12} /> {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre>{truncate(output, 20_000)}</pre>
        </div>
      )}
    </div>
  )
}
