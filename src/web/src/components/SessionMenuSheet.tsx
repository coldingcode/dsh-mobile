import { useEffect, useState } from 'react'
import { Copy, Link2, Pencil, Trash2 } from 'lucide-react'
import type { SessionSummary } from '../../../shared/protocol.ts'
import { copyText } from '../../../shared/protocol.ts'
import { useApp } from '../store.tsx'
import { haptic, share } from '../native.ts'
import { Sheet } from './Sheet.tsx'

interface Props {
  session: SessionSummary | undefined
  open: boolean
  onClose: () => void
}

export function SessionMenuSheet({ session, open, onClose }: Props) {
  const { actions } = useApp()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open && session !== undefined) {
      setTitle(session.title)
      setRenaming(false)
      setConfirmDelete(false)
    }
  }, [open, session])

  if (session === undefined) return null
  return (
    <Sheet open={open} onClose={onClose} title="会话" subtitle={session.cwd}>
      {renaming ? (
        <div className="form-stack">
          <label className="field-label" htmlFor="rename-title">标题</label>
          <input
            id="rename-title"
            className="text-field"
            value={title}
            autoFocus
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="sheet-actions">
            <button className="ghost-btn" onClick={() => setRenaming(false)}>取消</button>
            <button
              className="primary-btn"
              onClick={async () => {
                await actions.rename(session.id, title)
                setRenaming(false)
                onClose()
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="menu-list">
          <button className="menu-row" onClick={() => setRenaming(true)}>
            <Pencil size={17} /> <span>重命名会话</span>
          </button>
          <button
            className="menu-row"
            onClick={async () => {
              await copyText(session.id)
              actions.toast('会话 ID 已复制', 'success')
              haptic('success')
            }}
          >
            <Copy size={17} /> <span>复制会话 ID</span>
          </button>
          <button
            className="menu-row"
            onClick={() => {
              void share({
                title: session.title,
                text: '来自本机 DSH 的会话',
                url: window.location.origin + '/#/session/' + encodeURIComponent(session.id),
              })
            }}
          >
            <Link2 size={17} /> <span>分享会话链接</span>
          </button>
          <div className="menu-divider" />
          {confirmDelete ? (
            <div className="danger-confirm">
              <p>只从手机端移除，不会删除电脑上的 DSH 会话记录。</p>
              <div className="sheet-actions">
                <button className="ghost-btn" onClick={() => setConfirmDelete(false)}>取消</button>
                <button
                  className="danger-btn"
                  onClick={async () => {
                    await actions.remove(session.id)
                    onClose()
                  }}
                >
                  确认移除
                </button>
              </div>
            </div>
          ) : (
            <button className="menu-row danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={17} /> <span>从手机端移除</span>
            </button>
          )}
          <p className="menu-note">电脑上的会话日志和文件不会被删除。运行中的会话需要先停止。</p>
        </div>
      )}
    </Sheet>
  )
}
