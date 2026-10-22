import { useMemo, useState } from 'react'
import { Activity, Check, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ActivityItem } from '../../../shared/protocol.ts'
import { ConnectionPill } from '../components/ConnectionPill.tsx'
import { toolIcon } from '../components/ToolIcon.ts'
import { useApp, useLiveNow } from '../store.tsx'
import { formatDuration, formatTime, relativeTime, stripAnsi, truncate } from '../format.ts'
import { haptic } from '../native.ts'

type Filter = 'all' | 'running' | 'error'

export function ActivityScreen() {
  const { state, actions } = useApp()
  useLiveNow(20_000)
  const [filter, setFilter] = useState<Filter>('all')
  const items = state.activity ?? []
  const filtered = useMemo(() => items.filter((item) => (
    filter === 'all' ? true : filter === 'running' ? item.entry.status === 'running' : item.entry.status === 'error'
  )), [items, filter])
  const running = items.filter((item) => item.entry.status === 'running').length
  const errors = items.filter((item) => item.entry.status === 'error').length

  return (
    <main className="screen activity-screen">
      <div className="screen-inner">
        <header className="home-head">
          <div className="brand-line">
            <div className="brand-mark xs">d</div>
            <span className="brand-word">dsh<span>/</span>mobile</span>
            <ConnectionPill socket={state.socket} runtime={state.runtime} onClick={() => void actions.refresh()} />
          </div>
          <div className="home-title-row">
            <div>
              <h1 className="h1">活动</h1>
              <p className="home-sub">工具调用、子代理与运行状态</p>
            </div>
            <button className="icon-btn" onClick={() => { haptic('light'); void actions.loadActivity() }} aria-label="刷新活动">
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="stat-strip">
            <div className="stat"><strong>{running}</strong><span>运行中</span></div>
            <div className="stat"><strong>{items.length}</strong><span>最近调用</span></div>
            <div className="stat"><strong>{errors}</strong><span>失败</span></div>
          </div>
          <div className="filter-row">
            {(['all', 'running', 'error'] as Filter[]).map((value) => (
              <button
                key={value}
                className={'filter-chip' + (filter === value ? ' active' : '')}
                onClick={() => { haptic('light'); setFilter(value) }}
              >
                {value === 'all' ? '全部' : value === 'running' ? '运行中' : '失败'}
              </button>
            ))}
          </div>
        </header>

        {state.activityLoading && items.length === 0 ? (
          <div className="activity-list">
            {[0, 1, 2].map((index) => <div className="activity-skeleton" key={index} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-block">
            <div className="empty-orb small"><Activity size={26} /></div>
            <h2>{filter === 'all' ? '还没有工具活动' : filter === 'running' ? '现在没有运行中的工具' : '没有失败的调用'}</h2>
            <p>{filter === 'all' ? '当本机 DSH 运行命令、读取文件或搜索网页时，会出现在这里。' : '切回全部看看最近的活动。'}</p>
          </div>
        ) : (
          <div className="activity-list">
            {filtered.map((item) => <ActivityRow key={item.sessionId + ':' + item.entry.id} item={item} onOpen={() => actions.openSession(item.sessionId, item.entry.id)} />)}
          </div>
        )}
      </div>
    </main>
  )
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: () => void }) {
  const Icon = toolIcon(item.entry.name)
  const entry = item.entry
  const meta = entry.meta?.command ?? entry.meta?.path ?? entry.meta?.query ?? entry.meta?.url ?? ''
  const duration = entry.endedAt !== undefined ? formatDuration(entry.endedAt - entry.startedAt) : undefined
  return (
    <button className={'activity-row ' + entry.status} onClick={() => { haptic('light'); onOpen() }}>
      <span className={'activity-icon ' + entry.status}><Icon size={16} /></span>
      <span className="activity-main">
        <span className="activity-top">
          <strong>{entry.title}</strong>
          <span className={'tool-status ' + entry.status}>
            {entry.status === 'running' ? <Loader2 size={11} className="spin" /> : entry.status === 'error' ? <TriangleAlert size={11} /> : <Check size={11} />}
            {entry.status === 'running' ? '运行中' : entry.status === 'error' ? '失败' : '完成'}
          </span>
        </span>
        {meta !== '' && <span className="activity-meta mono">{truncate(stripAnsi(meta), 110)}</span>}
        <span className="activity-foot">
          <span className="ellipsis">{item.sessionTitle}</span>
          <span>{relativeTime(entry.endedAt ?? entry.startedAt)}</span>
          {duration !== undefined && <span className="mono">{duration}</span>}
        </span>
      </span>
      <span className="activity-time mono">{formatTime(entry.ts)}</span>
    </button>
  )
}
