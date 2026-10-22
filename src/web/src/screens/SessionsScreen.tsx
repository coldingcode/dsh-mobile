import { useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { ConnectionPill } from '../components/ConnectionPill.tsx'
import { NewSessionSheet } from '../components/NewSessionSheet.tsx'
import { SessionCard } from '../components/SessionCard.tsx'
import { useApp, useLiveNow } from '../store.tsx'
import { haptic } from '../native.ts'
import { platformName } from '../format.ts'

export function SessionsScreen() {
  const { state, actions } = useApp()
  const now = useLiveNow(30_000)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const sessions = state.sessions
  const runningCount = sessions.filter((session) => session.running).length
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return sessions
    return sessions.filter((session) => (
      session.title.toLowerCase().includes(needle)
      || (session.lastPreview ?? '').toLowerCase().includes(needle)
      || session.cwd.toLowerCase().includes(needle)
    ))
  }, [query, sessions])

  return (
    <>
      <main className="screen home-screen">
        <div className="screen-inner">
          <header className="home-head">
            <div className="brand-line">
              <div className="brand-mark xs">d</div>
              <span className="brand-word">dsh<span>/</span>mobile</span>
              <ConnectionPill socket={state.socket} runtime={state.runtime} onClick={() => void actions.refresh()} />
            </div>
            <div className="home-title-row">
              <div>
                <h1 className="h1">对话</h1>
                <p className="home-sub">
                  {state.server?.serverName ?? '本机 DSH'} · {platformName(state.server?.platform ?? '')}
                  {runningCount > 0 ? ' · ' + runningCount + ' 个运行中' : ''}
                </p>
              </div>
              <div className="home-actions">
                <button
                  className={'icon-btn' + (refreshing ? ' spinning' : '')}
                  onClick={async () => {
                    setRefreshing(true)
                    haptic('light')
                    try {
                      await actions.refresh()
                    } finally {
                      window.setTimeout(() => setRefreshing(false), 500)
                    }
                  }}
                  aria-label="刷新会话"
                >
                  <RefreshCw size={18} />
                </button>
                <button className="icon-btn accent" onClick={() => { haptic('medium'); setCreating(true) }} aria-label="新对话">
                  <Plus size={20} strokeWidth={2.2} />
                </button>
              </div>
            </div>
            <div className="search-pill glass-pill">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、消息或目录"
                aria-label="搜索会话"
              />
              {query !== '' && (
                <button className="search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
                  <X size={14} />
                </button>
              )}
            </div>
          </header>

          {state.runtime.state === 'error' && (
            <div className="inline-alert">
              <Sparkles size={15} />
              <div>
                <strong>本机运行时出错</strong>
                <span>{state.runtime.message ?? '发送一条消息会尝试重新启动运行时。'}</span>
              </div>
            </div>
          )}
          {state.socket === 'closed' && state.runtime.state !== 'error' && (
            <div className="inline-alert soft">
              <RefreshCw size={15} />
              <div><strong>正在重新连接</strong><span>桥接已断开，App 会在后台自动重试。</span></div>
            </div>
          )}

          {filtered.length > 0 ? (
            <section className="session-list" aria-label="会话列表">
              {filtered.map((session) => (
                <SessionCard key={session.id} session={session} now={now} onClick={() => actions.openSession(session.id)} />
              ))}
            </section>
          ) : query !== '' ? (
            <div className="empty-block">
              <div className="empty-orb small"><Search size={26} /></div>
              <h2>没有匹配的会话</h2>
              <p>换个关键词，或清空搜索。</p>
            </div>
          ) : (
            <div className="empty-block home-empty">
              <div className="empty-orb"><Sparkles size={30} /></div>
              <h2>把第一件事交给本机 DSH</h2>
              <p>手机只负责发消息，代码、文件和命令都在你的电脑上执行。</p>
              <div className="suggestion-grid">
                {[
                  ['看看这个工作区', '先给我一个概览'],
                  ['运行测试并修复', '从失败日志开始'],
                  ['整理最近的改动', '给我一个清晰的总结'],
                ].map(([title, hint]) => (
                  <button
                    className="suggestion"
                    key={title}
                    onClick={() => {
                      haptic('light')
                      setCreating(true)
                    }}
                  >
                    <strong>{title}</strong>
                    <span>{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
      <NewSessionSheet open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
