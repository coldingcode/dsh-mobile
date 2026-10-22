import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../store.tsx'
import { Sheet } from './Sheet.tsx'

interface Props {
  open: boolean
  onClose: () => void
  runningCount: number
}

export function StopSheet({ open, onClose, runningCount }: Props) {
  const { actions } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="停止当前运行？"
      subtitle="DSH SDK 不支持单轮取消。停止会重启本机运行时，并让所有进行中的会话中断；已写入的会话日志会保留。"
    >
      <div className="callout">
        <strong>{runningCount > 1 ? runningCount + ' 个会话正在运行' : '1 个会话正在运行'}</strong>
        <span>重启通常需要几秒钟，之后可以继续发送消息。</span>
      </div>
      <div className="sheet-actions">
        <button className="ghost-btn" onClick={onClose} disabled={busy}>再等等</button>
        <button
          className="danger-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await actions.stopCurrent()
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 size={16} className="spin" /> : null}
          {busy ? '正在停止…' : '停止并重启'}
        </button>
      </div>
    </Sheet>
  )
}
