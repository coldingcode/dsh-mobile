import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Copy,
  Cpu,
  Folder,
  Moon,
  Network,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
  Sun,
  SunMoon,
  Unplug,
  Wifi,
} from 'lucide-react'
import { ConnectionPill } from '../components/ConnectionPill.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { copyText } from '../../../shared/protocol.ts'
import { useApp, type Theme } from '../store.tsx'
import { haptic, isNative, openNativeSettings, platformLabel } from '../native.ts'
import { platformName, shortPath } from '../format.ts'

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', icon: SunMoon },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

export function SettingsScreen() {
  const { state, actions } = useApp()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [latency, setLatency] = useState<number | undefined>(undefined)
  const [haptics, setHaptics] = useState(() => {
    try {
      return localStorage.getItem('dshm-haptics') !== 'off'
    } catch {
      return true
    }
  })
  const danger = state.config?.permissionMode === 'danger-full-access'

  useEffect(() => {
    let cancelled = false
    const started = performance.now()
    void fetch('/api/health', { cache: 'no-store' }).then(() => {
      if (!cancelled) setLatency(Math.round(performance.now() - started))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [state.socket])

  return (
    <main className="screen settings-screen">
      <div className="screen-inner">
        <header className="home-head">
          <div className="brand-line">
            <div className="brand-mark xs">d</div>
            <span className="brand-word">dsh<span>/</span>mobile</span>
            <ConnectionPill socket={state.socket} runtime={state.runtime} onClick={() => void actions.refresh()} />
          </div>
          <div className="home-title-row">
            <div>
              <h1 className="h1">设置</h1>
              <p className="home-sub">连接、外观与设备安全</p>
            </div>
          </div>
        </header>

        <section className="profile-card glass">
          <div className="brand-mark">d</div>
          <div className="profile-main">
            <strong>{state.server?.serverName ?? '本机 DSH'}</strong>
            <span className="mono">{state.server?.hostname ?? ''} · {platformName(state.server?.platform ?? '')}</span>
            <div className="profile-chips">
              <span className={'chip ' + (danger ? 'yellow' : 'green')}>
                {danger ? <ShieldAlert size={12} /> : <Shield size={12} />}
                {danger ? '完整访问' : '工作区写入'}
              </span>
              <span className="chip">{state.config?.model ?? state.server?.model ?? 'deepseek-flash'}</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">连接</h2>
          <div className="settings-card glass">
            <Row icon={<Network size={17} />} title="桥接地址" value={window.location.host} mono onCopy={() => { void copyText(window.location.origin); actions.toast('地址已复制', 'success') }} />
            <Row icon={<Wifi size={17} />} title="延迟" value={latency !== undefined ? latency + ' ms' : '测量中…'} />
            <Row icon={<Cpu size={17} />} title="当前模型" value={(state.config?.model ?? state.server?.model ?? '').replace('deepseek-', '')} />
            <Row icon={<Folder size={17} />} title="默认工作区" value={shortPath(state.config?.workspace ?? '', 38)} mono onCopy={() => { void copyText(state.config?.workspace ?? ''); actions.toast('路径已复制', 'success') }} />
            <Row icon={<Smartphone size={17} />} title="设备" value={state.bootstrap?.device.name ?? platformLabel()} />
            <button className="settings-action-row" onClick={() => { haptic('light'); void actions.refresh(); actions.toast('正在刷新连接', 'info') }}>
              <RefreshCw size={16} /><span>重新连接</span><ChevronRight size={15} className="row-chev" />
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">外观</h2>
          <div className="theme-seg glass">
            {THEMES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.value}
                  className={'theme-option' + (state.theme === item.value ? ' active' : '')}
                  onClick={() => { haptic('light'); actions.setTheme(item.value) }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
          {isNative && (
            <div className="settings-card glass">
              <button
                className="settings-action-row"
                onClick={() => {
                  const next = !haptics
                  setHaptics(next)
                  try { localStorage.setItem('dshm-haptics', next ? 'on' : 'off') } catch {}
                  if (next) haptic('success')
                  else haptic('light')
                }}
              >
                <span className="haptic-icon"><Smartphone size={16} /></span>
                <span>触感反馈</span>
                <span className={'switch' + (haptics ? ' on' : '')}><i /></span>
              </button>
            </div>
          )}
        </section>

        <section className="settings-section">
          <h2 className="section-title">关于</h2>
          <div className="settings-card glass">
            <Row icon={<Shield size={17} />} title="应用版本" value={'v' + (state.bootstrap?.appVersion ?? '0.1.0')} mono />
            <Row icon={<Network size={17} />} title="桥接协议" value={'v' + String(state.bootstrap?.protocol ?? 1)} mono />
            <Row icon={<Cpu size={17} />} title="运行时" value={state.runtime.state === 'ready' ? 'DSH SDK · ready' : state.runtime.state} />
            {isNative && (
              <button className="settings-action-row" onClick={() => { haptic('light'); openNativeSettings() }}>
                <Smartphone size={16} /><span>打开原生设置</span><ChevronRight size={15} className="row-chev" />
              </button>
            )}
            <div className="settings-note">
              <p>dsh-mobile 不经过 App Store 分发。安装包由 GitHub Actions 构建，使用你自己的签名或 AltStore / SideStore 自签安装。</p>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">安全</h2>
          <div className="settings-card glass">
            <div className="settings-note">
              <p>令牌只保存在这台设备的钥匙串中。电脑端的配对页可以随时移除设备；移除后这台手机需要重新扫码。</p>
            </div>
            <button className="settings-action-row danger" onClick={() => setConfirmLogout(true)}>
              <Unplug size={16} /><span>断开此设备</span><ChevronRight size={15} className="row-chev" />
            </button>
          </div>
        </section>

        <div className="settings-foot">
          <span>dsh / mobile</span>
          <span>MIT · self-hosted</span>
        </div>
      </div>

      <Sheet
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="断开这台设备？"
        subtitle="手机上的配对令牌会被吊销。电脑上的 DSH 会话和文件不会受影响。"
      >
        <div className="callout warn">
          <strong>下次需要重新扫码</strong>
          <span>你可以在电脑的配对页重新允许这台设备。</span>
        </div>
        <div className="sheet-actions">
          <button className="ghost-btn" onClick={() => setConfirmLogout(false)}>取消</button>
          <button className="danger-btn" onClick={() => { setConfirmLogout(false); void actions.logout() }}>断开并清除</button>
        </div>
      </Sheet>
    </main>
  )
}

function Row({ icon, title, value, mono = false, onCopy }: { icon: ReactNode; title: string; value: string; mono?: boolean; onCopy?: () => void }) {
  return (
    <div className="settings-row">
      <span className="settings-icon">{icon}</span>
      <span className="settings-label">{title}</span>
      <span className={'settings-value ' + (mono ? 'mono' : '')}>{value}</span>
      {onCopy !== undefined && (
        <button className="row-copy" onClick={onCopy} aria-label="复制">
          <Copy size={13} />
        </button>
      )}

    </div>
  )
}
