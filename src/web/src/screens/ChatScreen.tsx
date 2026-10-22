import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronLeft, Loader2, MoreHorizontal, ShieldAlert } from 'lucide-react'
import { Composer } from '../components/Composer.tsx'
import { EntryView } from '../components/EntryView.tsx'
import { SessionMenuSheet } from '../components/SessionMenuSheet.tsx'
import { StopSheet } from '../components/StopSheet.tsx'
import { useApp } from '../store.tsx'
import { formatDay } from '../format.ts'
import { haptic } from '../native.ts'
import type { JournalEntry, ToolEntry } from '../../../shared/protocol.ts'

function DaySeparator({ ts }: { ts: number }) {
  return <div className="day-sep"><span>{formatDay(ts)}</span></div>
}

export function ChatScreen() {
  const { state, actions } = useApp()
  const route = state.route
  const sessionId = route.name === 'chat' ? route.sessionId : ''
  const session = state.sessions.find((item) => item.id === sessionId)
  const entries = state.entries[sessionId] ?? []
  const loading = state.loading[sessionId] === true
  const pending = state.pending?.sessionId === sessionId ? state.pending : undefined
  const running = session?.running === true || session?.status === 'running'
  const currentTool = [...entries].reverse().find((entry): entry is ToolEntry => entry.kind === 'tool' && entry.status === 'running')
  const [menuOpen, setMenuOpen] = useState(false)
  const [stopOpen, setStopOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const mountedRef = useRef(false)
  const entryId = route.name === 'chat' ? route.entryId : undefined

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current
    if (node === null) return
    node.scrollTo({ top: node.scrollHeight, behavior })
    stickRef.current = true
    setAtBottom(true)
  }

  useLayoutEffect(() => {
    if (entries.length === 0 && pending === undefined) return
    if (!stickRef.current) return
    const node = scrollRef.current
    if (node === null) return
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [entries.length, pending, running, currentTool?.id])

  useEffect(() => {
    if (mountedRef.current || loading) return
    mountedRef.current = true
    if (entries.length > 0) scrollToBottom('auto')
  }, [loading, entries.length])

  useEffect(() => {
    if (entryId === undefined || loading) return
    const node = scrollRef.current?.querySelector('[data-entry-id="' + CSS.escape(entryId) + '"]')
    if (node !== null && node !== undefined) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      node.classList.add('flash')
      window.setTimeout(() => node.classList.remove('flash'), 2200)
      stickRef.current = false
      setAtBottom(false)
    }
  }, [entryId, loading, entries.length])

  const onScroll = () => {
    const node = scrollRef.current
    if (node === null) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    const next = distance < 90
    stickRef.current = next
    setAtBottom(next)
  }

  const renderEntries: Array<{ type: 'entry'; entry: JournalEntry } | { type: 'day'; ts: number }> = []
  let lastDay = ''
  for (const entry of entries) {
    const day = formatDay(entry.ts)
    if (day !== lastDay) {
      renderEntries.push({ type: 'day', ts: entry.ts })
      lastDay = day
    }
    renderEntries.push({ type: 'entry', entry })
  }

  return (
    <>
      <main className="screen chat-screen">
        <header className="chat-head">
          <div className="chat-head-inner">
            <button className="icon-btn plain" onClick={() => { haptic('light'); actions.goBack() }} aria-label="返回">
              <ChevronLeft size={23} />
            </button>
            <div className="chat-head-title">
              <strong className="ellipsis">{session?.title ?? '对话'}</strong>
              <span className={running ? 'live' : ''}>
                {running ? (currentTool !== undefined ? currentTool.title + '…' : '正在思考') : session?.status === 'error' ? '上次运行出错' : (session?.model ?? state.config?.model ?? '').replace('deepseek-', '')}
              </span>
            </div>
            <button className="icon-btn plain" onClick={() => { haptic('light'); setMenuOpen(true) }} aria-label="会话菜单">
              <MoreHorizontal size={22} />
            </button>
          </div>
        </header>

        {state.runtime.state === 'error' && (
          <div className="chat-runtime-alert">
            <ShieldAlert size={14} />
            <span>运行时出错，发送消息会尝试重新启动。</span>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-list">
            {loading && entries.length === 0 ? (
              <div className="chat-loading">
                <div className="skeleton-line wide" />
                <div className="skeleton-bubble" />
                <div className="skeleton-line" />
                <div className="skeleton-bubble short" />
              </div>
            ) : entries.length === 0 && pending === undefined ? (
              <div className="empty-block chat-empty">
                <div className="empty-orb"><span className="orb-glyph">&gt;_</span></div>
                <h2>开始一段本机对话</h2>
                <p>消息会发送到 {state.server?.serverName ?? '你的电脑'}，并在 <span className="mono tiny">{session?.cwd ?? state.config?.workspace}</span> 中执行。</p>
                <div className="prompt-chips">
                  {['先给我一个工作区概览', '运行测试，失败就修复', '总结最近一轮改动'].map((text) => (
                    <button key={text} className="prompt-chip" onClick={() => { haptic('light'); void actions.sendPrompt(text) }}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              renderEntries.map((item, index) => item.type === 'day'
                ? <DaySeparator key={'day-' + index} ts={item.ts} />
                : <EntryView key={item.entry.id} entry={item.entry} />)
            )}

            {pending !== undefined && (
              <div className="msg msg-user pending-message">
                <div className="bubble-user">
                  {pending.images.map((image, index) => <img className="user-image" src={image.preview} alt={'附件 ' + (index + 1)} key={index} />)}
                  {pending.text !== '' && <div className="user-text">{pending.text}</div>}
                  <div className="bubble-time sending"><Loader2 size={11} className="spin" /> 发送中</div>
                </div>
              </div>
            )}

            {running && (
              <div className="thinking-row">
                <span className="thinking-orb" />
                <span>{currentTool !== undefined ? currentTool.title + '…' : '正在思考'}</span>
                <span className="thinking-dots"><i /><i /><i /></span>
              </div>
            )}
            <div className="chat-bottom-space" />
          </div>
        </div>

        {!atBottom && entries.length > 0 && (
          <button className="jump-bottom" onClick={() => scrollToBottom()} aria-label="回到底部">
            <ArrowDown size={17} />
          </button>
        )}

        <Composer
          running={running}
          sending={pending !== undefined}
          onSend={(text, images) => { void actions.sendPrompt(text, images) }}
          onStop={() => { haptic('warning'); setStopOpen(true) }}
        />
      </main>

      <SessionMenuSheet session={session} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <StopSheet open={stopOpen} onClose={() => setStopOpen(false)} runningCount={state.sessions.filter((item) => item.running).length || 1} />
    </>
  )
}
