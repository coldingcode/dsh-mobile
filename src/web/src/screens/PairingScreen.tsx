import { useEffect, useState } from 'react'
import { ArrowRight, Check, KeyRound, Loader2, Lock, QrCode, RefreshCw, ShieldCheck } from 'lucide-react'
import { formatPairCode, normalizePairCode, type PairRequestReceipt } from '../../../shared/protocol.ts'
import * as api from '../api.ts'
import { disconnectNative, haptic, isNative } from '../native.ts'

type Phase = 'idle' | 'requesting' | 'pending' | 'error'

export function PairingScreen() {
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [receipt, setReceipt] = useState<PairRequestReceipt | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (receipt === undefined) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void api.pairStatus(window.location.origin, receipt.requestId).then(async (status) => {
        if (cancelled) return
        if (status.status === 'approved' && status.token !== undefined) {
          window.clearInterval(timer)
          try {
            await api.authSession(status.token)
            api.setAuthToken(status.token)
            haptic('success')
            window.location.reload()
          } catch (reason) {
            setPhase('error')
            setError(reason instanceof api.ApiError ? reason.message : '无法保存登录状态')
            setReceipt(undefined)
          }
        } else if (status.status === 'denied' || status.status === 'expired') {
          window.clearInterval(timer)
          setPhase('error')
          setError(status.reason ?? (status.status === 'denied' ? '电脑端拒绝了这次配对' : '配对请求已过期'))
          setReceipt(undefined)
        }
      }).catch((reason: unknown) => {
        if (cancelled) return
        window.clearInterval(timer)
        setPhase('error')
        setError(reason instanceof api.ApiError ? reason.message : '无法查询配对状态')
        setReceipt(undefined)
      })
    }, 1200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [receipt])

  const submit = async () => {
    if (normalizePairCode(code).length !== 8 || phase === 'requesting') return
    haptic('medium')
    setError('')
    setPhase('requesting')
    try {
      const value = await api.pairRequest(window.location.origin, code)
      setReceipt(value)
      setPhase('pending')
    } catch (reason) {
      setPhase('error')
      setError(reason instanceof api.ApiError ? reason.message : '无法发起配对')
    }
  }

  if (isNative) {
    return (
      <main className="pair-screen">
        <div className="pair-inner">
          <div className="brand-mark">d</div>
          <span className="kicker">dsh-mobile</span>
          <h1 className="h1">需要重新配对</h1>
          <p className="pair-lede">App 中保存的设备令牌已失效，或者电脑端的设备已被移除。回到 App 的启动页重新扫描配对二维码。</p>
          <button className="primary-btn wide" onClick={() => disconnectNative()}>
            <QrCode size={18} /> 回到扫码页
          </button>
          <p className="pair-fineprint">令牌只保存在 iPhone 钥匙串中，WebView 不会持久化它。</p>
        </div>
      </main>
    )
  }

  return (
    <main className="pair-screen">
      <div className="pair-inner">
        <div className="pair-top">
          <div className="brand-mark">d</div>
          <div className="pair-brand">dsh<span>/</span>mobile</div>
        </div>

        <div className="pair-hero">
          <span className="kicker">Local connection</span>
          <h1 className="h1">连接本机<br />DeepSeek Harness</h1>
          <p className="pair-lede">这个页面由你电脑上的 dsh-mobile 插件提供。输入电脑配对页上的 8 位码，就能把这个浏览器变成受信任设备。</p>
        </div>

        <div className="pair-card glass">
          {phase === 'pending' && receipt !== undefined ? (
            <div className="pair-pending">
              <div className="pair-step-kicker"><Loader2 size={13} className="spin" /> 等待电脑确认</div>
              <div className="verification-code">{receipt.verificationCode}</div>
              <p>核对电脑配对页上的 6 位数字。确认后，这台浏览器会自动登录。</p>
              <div className="pending-bar"><i /></div>
              <button className="ghost-btn" onClick={() => { setReceipt(undefined); setPhase('idle') }}>
                <RefreshCw size={15} /> 取消，重新输入
              </button>
            </div>
          ) : (
            <>
              <div className="pair-steps">
                <div className="pair-step">
                  <span className="pair-step-icon"><QrCode size={18} /></span>
                  <div><strong>在电脑上打开配对页</strong><span>加载 dsh-mobile 插件后，DSH 会打印配对链接并自动打开。</span></div>
                </div>
                <div className="pair-step">
                  <span className="pair-step-icon"><KeyRound size={18} /></span>
                  <div><strong>输入 8 位配对码</strong><span>配对码每 10 分钟刷新；手机和电脑需要在同一 Wi-Fi。</span></div>
                </div>
                <div className="pair-step">
                  <span className="pair-step-icon"><ShieldCheck size={18} /></span>
                  <div><strong>核对 6 位数字</strong><span>电脑端和这里会显示同一个核对码，确认后才会签发令牌。</span></div>
                </div>
              </div>

              <label className="field-label" htmlFor="pair-code"><Lock size={13} /> 配对码</label>
              <div className="pair-input-wrap">
                <input
                  id="pair-code"
                  className="pair-input mono"
                  value={code}
                  placeholder="XXXX-XXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={9}
                  onChange={(event) => setCode(formatPairCode(event.target.value))}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
                />
                <button className="primary-btn pair-submit" onClick={() => void submit()} disabled={normalizePairCode(code).length !== 8 || phase === 'requesting'}>
                  {phase === 'requesting' ? <Loader2 size={17} className="spin" /> : <ArrowRight size={18} />}
                  {phase === 'requesting' ? '请求中' : '配对'}
                </button>
              </div>
              {error !== '' && <div className="pair-error">{error}</div>}
              <p className="pair-fineprint"><Check size={12} /> 浏览器只保存 HttpOnly 会话 Cookie；配对令牌不会出现在网址中。</p>
            </>
          )}
        </div>

        <div className="pair-hint">
          <span className="pair-hint-dot" />
          推荐使用 iPhone App 扫码；原生壳会把令牌存进钥匙串，并支持相机扫码与后台重连。
        </div>
      </div>
    </main>
  )
}
