import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Bootstrap,
  JournalEntry,
  RuntimeStatus,
  ServerEvent,
  SessionSummary,
  ActivityItem,
  WorkspaceConfig,
  ServerInfo,
} from '../../shared/protocol.ts'
import * as api from './api.ts'
import { disconnectNative, haptic, isNative, nativeConfig, notifyReady } from './native.ts'
import { BridgeSocket, type SocketState } from './ws.ts'

export type Route =
  | { name: 'sessions' }
  | { name: 'chat'; sessionId: string; entryId?: string }
  | { name: 'activity' }
  | { name: 'settings' }

export type Phase = 'boot' | 'unauth' | 'ready' | 'fatal'
export type Theme = 'system' | 'light' | 'dark'

export interface PendingPrompt {
  sessionId: string
  text: string
  images: api.PromptImage[]
  at: number
}

export interface ToastState {
  id: number
  message: string
  tone: 'info' | 'error' | 'success'
}

interface AppState {
  phase: Phase
  error?: string
  bootstrap?: Bootstrap
  server?: ServerInfo
  config?: WorkspaceConfig
  sessions: SessionSummary[]
  entries: Record<string, JournalEntry[]>
  loaded: Record<string, boolean>
  loading: Record<string, boolean>
  truncated: Record<string, boolean>
  activeId?: string
  pending?: PendingPrompt
  runtime: RuntimeStatus
  socket: SocketState
  route: Route
  activity?: ActivityItem[]
  activityLoading: boolean
  toast?: ToastState
  theme: Theme
}

type Action =
  | { type: 'phase'; phase: Phase; error?: string }
  | { type: 'hello'; server: ServerInfo; config: WorkspaceConfig }
  | { type: 'bootstrap'; bootstrap: Bootstrap }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'upsert'; session: SessionSummary }
  | { type: 'remove'; sessionId: string }
  | { type: 'detail'; sessionId: string; entries: JournalEntry[]; truncated?: boolean }
  | { type: 'entries'; sessionId: string; entries: JournalEntry[] }
  | { type: 'entry'; sessionId: string; entry: JournalEntry }
  | { type: 'loading'; sessionId: string; loading: boolean }
  | { type: 'active'; sessionId?: string }
  | { type: 'pending'; pending?: PendingPrompt }
  | { type: 'runtime'; runtime: RuntimeStatus }
  | { type: 'socket'; socket: SocketState }
  | { type: 'route'; route: Route }
  | { type: 'activity'; items: ActivityItem[]; loading: boolean }
  | { type: 'toast'; toast?: ToastState }
  | { type: 'theme'; theme: Theme }

function upsertEntry(entries: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const index = entries.findIndex((item) => item.id === entry.id)
  const next = index >= 0 ? entries.map((item, at) => (at === index ? entry : item)) : [...entries, entry]
  next.sort((a, b) => (a.order - b.order) || (a.ts - b.ts))
  return next
}

function upsertSession(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
  const index = sessions.findIndex((item) => item.id === session.id)
  const next = index >= 0 ? sessions.map((item, at) => (at === index ? session : item)) : [session, ...sessions]
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  return next
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'phase':
      return { ...state, phase: action.phase, ...(action.error !== undefined ? { error: action.error } : { error: undefined }) }
    case 'hello':
      return { ...state, server: action.server, config: action.config }
    case 'bootstrap':
      return {
        ...state,
        phase: 'ready',
        error: undefined,
        bootstrap: action.bootstrap,
        server: action.bootstrap.server,
        config: action.bootstrap.config,
        sessions: action.bootstrap.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt),
      }
    case 'sessions':
      return { ...state, sessions: action.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt) }
    case 'upsert':
      return { ...state, sessions: upsertSession(state.sessions, action.session) }
    case 'remove':
      return {
        ...state,
        sessions: state.sessions.filter((session) => session.id !== action.sessionId),
        entries: Object.fromEntries(Object.entries(state.entries).filter(([id]) => id !== action.sessionId)),
      }
    case 'detail': {
      const previous = state.entries[action.sessionId] ?? []
      const entries = action.entries.slice().sort((a, b) => (a.order - b.order) || (a.ts - b.ts))
      const merged = entries.length >= previous.length ? entries : mergeEntries(previous, entries)
      return {
        ...state,
        entries: { ...state.entries, [action.sessionId]: merged },
        loaded: { ...state.loaded, [action.sessionId]: true },
        loading: { ...state.loading, [action.sessionId]: false },
        ...(action.truncated === true ? { truncated: { ...state.truncated, [action.sessionId]: true } } : {}),
      }
    }
    case 'entries':
      return { ...state, entries: { ...state.entries, [action.sessionId]: action.entries }, loaded: { ...state.loaded, [action.sessionId]: true } }
    case 'entry': {
      const current = state.entries[action.sessionId] ?? []
      const existing = current.find((entry) => entry.id === action.entry.id)
      if (existing !== undefined && existing.order === action.entry.order && existing.ts === action.entry.ts) return state
      const entries = upsertEntry(current, action.entry)
      const clearsPending = action.entry.kind === 'user' && state.pending?.sessionId === action.sessionId
      return {
        ...state,
        entries: { ...state.entries, [action.sessionId]: entries },
        ...(clearsPending ? { pending: undefined } : {}),
      }
    }
    case 'loading':
      return { ...state, loading: { ...state.loading, [action.sessionId]: action.loading } }
    case 'active':
      return { ...state, activeId: action.sessionId }
    case 'pending':
      return { ...state, pending: action.pending }
    case 'runtime':
      return { ...state, runtime: action.runtime }
    case 'socket':
      return { ...state, socket: action.socket }
    case 'route':
      return { ...state, route: action.route }
    case 'activity':
      return { ...state, activity: action.items, activityLoading: action.loading }
    case 'toast':
      return { ...state, toast: action.toast }
    case 'theme':
      return { ...state, theme: action.theme }
    default:
      return state
  }
}

function mergeEntries(older: JournalEntry[], newer: JournalEntry[]): JournalEntry[] {
  let merged = older
  for (const entry of newer) merged = upsertEntry(merged, entry)
  return merged
}

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#/u, '') || '/'
  const [pathPart = '/', queryPart = ''] = clean.split('?')
  const segments = pathPart.split('/').filter((segment) => segment !== '')
  if (segments[0] === 'session' && segments[1] !== undefined) {
    const entryId = new URLSearchParams(queryPart).get('entry')
    return { name: 'chat', sessionId: decodeURIComponent(segments[1]), ...(entryId !== null ? { entryId } : {}) }
  }
  if (segments[0] === 'activity') return { name: 'activity' }
  if (segments[0] === 'settings') return { name: 'settings' }
  return { name: 'sessions' }
}

function routeHash(route: Route): string {
  if (route.name === 'chat') return '#/session/' + encodeURIComponent(route.sessionId)
  if (route.name === 'activity') return '#/activity'
  if (route.name === 'settings') return '#/settings'
  return '#/'
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('dshm-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* ignore */
  }
  return 'system'
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    localStorage.setItem('dshm-theme', theme)
  } catch {
    /* ignore */
  }
}

function formatError(error: unknown): string {
  if (error instanceof api.ApiError) {
    if (error.status === 0) return '无法连接本机 DSH，请检查 Wi-Fi 和桥接服务。'
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export interface AppActions {
  refresh(): Promise<void>
  refreshSession(sessionId: string): Promise<void>
  openSession(sessionId: string, entryId?: string): void
  goBack(): void
  navigate(path: string): void
  sendPrompt(text: string, images?: api.PromptImage[]): Promise<void>
  stopCurrent(): Promise<void>
  createSession(input: { title?: string; cwd?: string }): Promise<SessionSummary | undefined>
  rename(sessionId: string, title: string): Promise<void>
  remove(sessionId: string): Promise<void>
  loadActivity(force?: boolean): Promise<void>
  setTheme(theme: Theme): void
  toast(message: string, tone?: ToastState['tone']): void
  logout(): Promise<void>
  clearPending(): void
  clearToast(): void
}

interface AppContextValue {
  state: AppState
  actions: AppActions
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    phase: 'boot' as Phase,
    sessions: [],
    entries: {},
    loaded: {},
    loading: {},
    truncated: {},
    runtime: { state: 'stopped' as const },
    socket: 'closed' as SocketState,
    route: parseRoute(window.location.hash),
    activityLoading: false,
    theme: initialTheme(),
  }))
  const stateRef = useRef(state)
  stateRef.current = state
  const socketRef = useRef<BridgeSocket | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  const pendingTimer = useRef<number | undefined>(undefined)
  const booted = useRef(false)
  const activityLoadedAt = useRef(0)
  const loadingRef = useRef<Set<string>>(new Set())

  const toast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    dispatch({ type: 'toast', toast: { id, message, tone } })
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => dispatch({ type: 'toast', toast: undefined }), 2800)
    if (tone === 'error') haptic('error')
    else if (tone === 'success') haptic('success')
  }, [])

  const loadSession = useCallback(async (sessionId: string, force = false) => {
    const current = stateRef.current
    if (!force && (current.loaded[sessionId] === true || loadingRef.current.has(sessionId))) return
    loadingRef.current.add(sessionId)
    dispatch({ type: 'loading', sessionId, loading: true })
    try {
      const detail = await api.getSession(sessionId)
      dispatch({ type: 'detail', sessionId, entries: detail.entries, ...(detail.truncated === true ? { truncated: true } : {}) })
      dispatch({ type: 'upsert', session: detail.session })
    } catch (error) {
      if (api.isUnauthorized(error)) {
        dispatch({ type: 'phase', phase: 'unauth', error: '设备令牌已失效，请重新配对。' })
      } else {
        toast(formatError(error), 'error')
      }
    } finally {
      loadingRef.current.delete(sessionId)
      dispatch({ type: 'loading', sessionId, loading: false })
    }
  }, [toast])

  const refresh = useCallback(async () => {
    try {
      const value = await api.bootstrap()
      dispatch({ type: 'bootstrap', bootstrap: value })
      const route = stateRef.current.route
      if (route.name === 'chat') {
        await loadSession(route.sessionId, true)
      }
    } catch (error) {
      if (api.isUnauthorized(error)) {
        dispatch({ type: 'phase', phase: 'unauth', error: '设备令牌已失效，请重新配对。' })
      } else {
        toast(formatError(error), 'error')
      }
    }
  }, [loadSession, toast])

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'hello':
        dispatch({ type: 'hello', server: event.server, config: event.config })
        dispatch({ type: 'runtime', runtime: event.runtime })
        break
      case 'session.upsert':
        dispatch({ type: 'upsert', session: event.session })
        break
      case 'session.entry':
        dispatch({ type: 'entry', sessionId: event.sessionId, entry: event.entry })
        dispatch({ type: 'upsert', session: event.session })
        break
      case 'session.status':
        dispatch({ type: 'upsert', session: event.session })
        break
      case 'session.remove':
        dispatch({ type: 'remove', sessionId: event.sessionId })
        break
      case 'runtime.status':
        dispatch({ type: 'runtime', runtime: event.runtime })
        if (event.runtime.state === 'error') toast('本机 DSH 运行时出错', 'error')
        break
     default:
        break
    }
  }, [toast])

  const ensureSocket = useCallback(() => {
    if (socketRef.current !== undefined) return
    const socket = new BridgeSocket({
      onEvent: handleEvent,
      onState: (socketState) => dispatch({ type: 'socket', socket: socketState }),
      onReconnect: () => {
        void refresh()
      },
    })
    socketRef.current = socket
    socket.start()
  }, [handleEvent, refresh])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    applyTheme(initialTheme())
    if (isNative && nativeConfig !== undefined) api.setAuthToken(nativeConfig.token)
    const boot = async () => {
      if (import.meta.env.DEV) {
        const url = new URL(window.location.href)
        const devToken = url.searchParams.get('token')
        if (devToken !== null && devToken !== '') {
          try {
            await api.authSession(devToken)
          } catch {
            /* the dev token may be stale; fall through to the pairing screen */
          }
          url.searchParams.delete('token')
          window.history.replaceState({}, '', url.pathname + url.search + url.hash)
        }
      }
      try {
        const value = await api.bootstrap()
        dispatch({ type: 'bootstrap', bootstrap: value })
        notifyReady()
      } catch (error) {
        if (api.isUnauthorized(error)) {
          dispatch({ type: 'phase', phase: 'unauth' })
        } else {
          dispatch({ type: 'phase', phase: 'fatal', error: formatError(error) })
        }
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    if (state.phase !== 'ready') return
    ensureSocket()
  }, [state.phase, ensureSocket])

  useEffect(() => {
    const onHash = () => {
      const route = parseRoute(window.location.hash)
      dispatch({ type: 'route', route })
      if (route.name === 'chat') {
        dispatch({ type: 'active', sessionId: route.sessionId })
        void loadSession(route.sessionId)
      } else {
        dispatch({ type: 'active', sessionId: undefined })
      }
    }
    window.addEventListener('hashchange', onHash)
    onHash()
    return () => window.removeEventListener('hashchange', onHash)
  }, [loadSession])

  useEffect(() => {
    if (state.phase !== 'ready') return
    if (state.route.name !== 'chat') return
    dispatch({ type: 'active', sessionId: state.route.sessionId })
    void loadSession(state.route.sessionId)
  }, [state.phase, state.route, loadSession])

  useEffect(() => {
    if (state.phase !== 'ready' || state.route.name !== 'activity') return
    if (Date.now() - activityLoadedAt.current < 5_000 && state.activity !== undefined) return
    void loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.route])

  useEffect(() => () => {
    socketRef.current?.stop()
    socketRef.current = undefined
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    if (pendingTimer.current !== undefined) window.clearTimeout(pendingTimer.current)
  }, [])

  const navigate = useCallback((path: string) => {
    const hash = path.startsWith('#') ? path : '#' + (path.startsWith('/') ? path : '/' + path)
    if (window.location.hash === hash) {
      const route = parseRoute(hash)
      dispatch({ type: 'route', route })
      return
    }
    window.location.hash = hash
  }, [])

  const openSession = useCallback((sessionId: string, entryId?: string) => {
    dispatch({ type: 'active', sessionId })
    navigate('/session/' + encodeURIComponent(sessionId) + (entryId !== undefined ? '?entry=' + encodeURIComponent(entryId) : ''))
  }, [navigate])

  const goBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  const clearPending = useCallback(() => {
    if (pendingTimer.current !== undefined) window.clearTimeout(pendingTimer.current)
    pendingTimer.current = undefined
    dispatch({ type: 'pending', pending: undefined })
  }, [])

  const sendPrompt = useCallback(async (text: string, images: api.PromptImage[] = []) => {
    const current = stateRef.current
    const sessionId = current.route.name === 'chat' ? current.route.sessionId : current.activeId
    if (sessionId === undefined) return
    if (current.pending !== undefined) {
      toast('上一条消息还在发送', 'info')
      return
    }
    const blocks: api.PromptContentBlock[] = []
    if (text.trim() !== '') blocks.push({ type: 'text', text })
    for (const image of images) blocks.push(api.imageBlock(image))
    if (blocks.length === 0) return
    haptic('medium')
    dispatch({ type: 'pending', pending: { sessionId, text, images, at: Date.now() } })
    if (pendingTimer.current !== undefined) window.clearTimeout(pendingTimer.current)
    pendingTimer.current = window.setTimeout(() => clearPending(), 20_000)
    try {
      const result = await api.prompt(sessionId, blocks)
      dispatch({ type: 'upsert', session: result.session })
    } catch (error) {
      clearPending()
      toast(formatError(error), 'error')
      void loadSession(sessionId, true)
    }
  }, [clearPending, loadSession, toast])

  const stopCurrent = useCallback(async () => {
    const current = stateRef.current
    const sessionId = current.route.name === 'chat' ? current.route.sessionId : current.activeId
    if (sessionId === undefined) return
    haptic('warning')
    try {
      await api.stopSession(sessionId)
      toast('已停止当前运行', 'success')
      await loadSession(sessionId, true)
    } catch (error) {
      toast(formatError(error), 'error')
    }
  }, [loadSession, toast])

  const createSession = useCallback(async (input: { title?: string; cwd?: string }) => {
    try {
      const result = await api.createSession(input)
      dispatch({ type: 'upsert', session: result.session })
      dispatch({ type: 'entries', sessionId: result.session.id, entries: [] })
      dispatch({ type: 'active', sessionId: result.session.id })
      navigate('/session/' + encodeURIComponent(result.session.id))
      haptic('success')
      return result.session
    } catch (error) {
      toast(formatError(error), 'error')
      return undefined
    }
  }, [navigate, toast])

  const rename = useCallback(async (sessionId: string, title: string) => {
    try {
      const result = await api.renameSession(sessionId, title)
      dispatch({ type: 'upsert', session: result.session })
      toast('已重命名', 'success')
    } catch (error) {
      toast(formatError(error), 'error')
    }
  }, [toast])

  const remove = useCallback(async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId)
      dispatch({ type: 'remove', sessionId })
      navigate('/')
      toast('已从手机端移除', 'success')
    } catch (error) {
      toast(formatError(error), 'error')
    }
  }, [navigate, toast])

  const loadActivity = useCallback(async () => {
    dispatch({ type: 'activity', items: stateRef.current.activity ?? [], loading: true })
    try {
      const result = await api.activity()
      activityLoadedAt.current = Date.now()
      dispatch({ type: 'activity', items: result.items, loading: false })
    } catch (error) {
      dispatch({ type: 'activity', items: stateRef.current.activity ?? [], loading: false })
      if (api.isUnauthorized(error)) dispatch({ type: 'phase', phase: 'unauth' })
      else toast(formatError(error), 'error')
    }
  }, [toast])

  const refreshSession = useCallback(async (sessionId: string) => {
    await loadSession(sessionId, true)
  }, [loadSession])

  const setThemeAction = useCallback((theme: Theme) => {
    applyTheme(theme)
    dispatch({ type: 'theme', theme })
    haptic('light')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* revoking is best effort */
    }
    api.setAuthToken(undefined)
    if (isNative) {
      disconnectNative()
      return
    }
    window.location.hash = ''
    window.location.reload()
  }, [])

  const clearToast = useCallback(() => dispatch({ type: 'toast', toast: undefined }), [])

  const actions = useMemo<AppActions>(() => ({
    refresh,
    refreshSession,
    openSession,
    goBack,
    navigate,
    sendPrompt,
    stopCurrent,
    createSession,
    rename,
    remove,
    loadActivity,
    setTheme: setThemeAction,
    toast,
    logout,
    clearPending,
    clearToast,
  }), [refresh, refreshSession, openSession, goBack, navigate, sendPrompt, stopCurrent, createSession, rename, remove, loadActivity, setThemeAction, toast, logout, clearPending, clearToast])

  return <AppContext.Provider value={{ state, actions }}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (value === undefined) throw new Error('useApp must be used inside AppProvider')
  return value
}

export function useLiveNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
