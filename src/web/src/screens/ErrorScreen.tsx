import { RefreshCw, Unplug, WifiOff } from 'lucide-react'
import { useApp } from '../store.tsx'
import { disconnectNative, isNative } from '../native.ts'

export function ErrorScreen() {
  const { state } = useApp()
  return (
    <main className="error-screen">
      <div className="error-card glass">
        <div className="error-icon"><WifiOff size={28} /></div>
        <span className="kicker">Connection lost</span>
        <h1 className="h2">连接不到本机 DSH</h1>
        <p>{state.error ?? '请确认电脑上的 DSH 正在运行，手机和电脑处于同一个 Wi-Fi。'}</p>
        <div className="sheet-actions">
          <button className="ghost-btn" onClick={() => window.location.reload()}><RefreshCw size={16} /> 重试</button>
          {isNative && <button className="danger-btn" onClick={() => disconnectNative()}><Unplug size={16} /> 重新配对</button>}
        </div>
      </div>
    </main>
  )
}
