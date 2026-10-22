import { Activity, MessageCircle, Settings2 } from 'lucide-react'
import type { Route } from '../store.tsx'
import { haptic } from '../native.ts'

interface Props {
  route: Route
  runningCount: number
  onNavigate: (path: string) => void
}

const TABS = [
  { key: 'sessions', label: '对话', icon: MessageCircle, path: '/' },
  { key: 'activity', label: '活动', icon: Activity, path: '/activity' },
  { key: 'settings', label: '设置', icon: Settings2, path: '/settings' },
] as const

export function TabBar({ route, runningCount, onNavigate }: Props) {
  const active = route.name === 'activity' ? 1 : route.name === 'settings' ? 2 : 0
  return (
    <nav className="tabbar" aria-label="主导航">
      <div className="tab-indicator" style={{ transform: 'translateX(' + active * 100 + '%)' }} />
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.key === (route.name === 'sessions' || route.name === 'chat' ? 'sessions' : route.name)
        return (
          <button
            key={tab.key}
            className={'tab' + (isActive ? ' active' : '')}
            onClick={() => {
              haptic('light')
              onNavigate(tab.path)
            }}
          >
            <Icon strokeWidth={1.9} />
            <span>{tab.label}</span>
            {tab.key === 'activity' && runningCount > 0 && <span className="tab-badge" />}
          </button>
        )
      })}
    </nav>
  )
}
