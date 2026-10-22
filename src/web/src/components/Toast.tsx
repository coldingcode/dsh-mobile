import { AlertTriangle, Check, Info } from 'lucide-react'
import { useApp } from '../store.tsx'

export function Toast() {
  const { state, actions } = useApp()
  if (state.toast === undefined) return null
  const tone = state.toast.tone
  return (
    <button className={'toast toast-' + tone} onClick={actions.clearToast}>
      <span className="toast-icon">
        {tone === 'error' ? <AlertTriangle size={15} /> : tone === 'success' ? <Check size={15} /> : <Info size={15} />}
      </span>
      <span>{state.toast.message}</span>
    </button>
  )
}
