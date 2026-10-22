import { useEffect } from 'react'
import { Aurora } from './components/Aurora.tsx'
import { TabBar } from './components/TabBar.tsx'
import { Toast } from './components/Toast.tsx'
import { ActivityScreen } from './screens/ActivityScreen.tsx'
import { BootScreen } from './screens/BootScreen.tsx'
import { ChatScreen } from './screens/ChatScreen.tsx'
import { ErrorScreen } from './screens/ErrorScreen.tsx'
import { PairingScreen } from './screens/PairingScreen.tsx'
import { SessionsScreen } from './screens/SessionsScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { useApp } from './store.tsx'
import { setNativeTitle } from './native.ts'

export function App() {
  const { state, actions } = useApp()
  const runningCount = state.sessions.filter((session) => session.running).length
  const route = state.route
  const activeSession = route.name === 'chat'
    ? state.sessions.find((session) => session.id === route.sessionId)
    : undefined

  useEffect(() => {
    if (state.route.name === 'chat' && activeSession !== undefined) setNativeTitle(activeSession.title + ' · dsh-mobile')
    else if (state.route.name === 'activity') setNativeTitle('活动 · dsh-mobile')
    else if (state.route.name === 'settings') setNativeTitle('设置 · dsh-mobile')
    else setNativeTitle('dsh-mobile')
  }, [state.route, activeSession])

  return (
    <div className="app-root">
      <Aurora />
      {state.phase === 'boot' && <BootScreen />}
      {state.phase === 'unauth' && <PairingScreen />}
      {state.phase === 'fatal' && <ErrorScreen />}
      {state.phase === 'ready' && (
        <>
          {state.route.name === 'chat' ? <ChatScreen /> : state.route.name === 'activity' ? <ActivityScreen /> : state.route.name === 'settings' ? <SettingsScreen /> : <SessionsScreen />}
          {state.route.name !== 'chat' && (
            <TabBar
              route={state.route}
              runningCount={runningCount}
              onNavigate={(path) => actions.navigate(path)}
            />
          )}
        </>
      )}
      <Toast />
    </div>
  )
}
