import { ChevronRight, Loader2 } from 'lucide-react'
import type { SessionSummary } from '../../../shared/protocol.ts'
import { formatTime, relativeTime, stripPreviewMarkdown } from '../format.ts'
import { haptic } from '../native.ts'

interface Props {
  session: SessionSummary
  now?: number
  onClick: () => void
}

export function SessionCard({ session, now = Date.now(), onClick }: Props) {
  const running = session.running || session.status === 'running'
  const failed = session.status === 'error'
  return (
    <button
      className={'session-card' + (running ? ' running' : '') + (failed ? ' failed' : '')}
      onClick={() => {
        haptic('light')
        onClick()
      }}
    >
      <div className="session-top">
        <span className={'session-dot ' + (running ? 'busy' : failed ? 'error' : '')} />
        <span className="session-title ellipsis">{session.title}</span>
        <span className="session-time tiny muted">{relativeTime(session.updatedAt, now)}</span>
        <ChevronRight size={15} className="session-chev" />
      </div>
      <div className={'session-preview clamp-2' + (session.lastPreview === undefined ? ' placeholder' : '')}>
        {session.lastPreview !== undefined ? stripPreviewMarkdown(session.lastPreview) : '还没有消息，点开开始第一轮对话。'}
      </div>
      <div className="session-foot">
        <span className="chip">{session.model.replace('deepseek-', '')}</span>
        <span className="session-cwd ellipsis mono">{session.cwd.replaceAll('\\', '/').split('/').slice(-2).join('/')}</span>
        {running && (
          <span className="session-live">
            <Loader2 size={11} className="spin" /> 运行中
          </span>
        )}
        {!running && <span className="session-time-abs tiny muted mono">{formatTime(session.updatedAt)}</span>}
      </div>
    </button>
  )
}
