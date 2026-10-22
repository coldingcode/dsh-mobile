import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { haptic } from '../native.ts'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  showClose?: boolean
}

export function Sheet({ open, onClose, title, subtitle, children, footer, showClose = true }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={() => { haptic('light'); onClose() }} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title ?? '面板'}>
        <div className="sheet-grabber" />
        <div className="sheet-body">
          {(title !== undefined || showClose) && (
            <div className="sheet-head">
              <div>
                {title !== undefined && <h2 className="sheet-title">{title}</h2>}
                {subtitle !== undefined && <p className="sheet-sub">{subtitle}</p>}
              </div>
              {showClose && (
                <button className="icon-btn sm plain" onClick={onClose} aria-label="关闭">
                  <X size={18} />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
        {footer !== undefined && <div className="sheet-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
