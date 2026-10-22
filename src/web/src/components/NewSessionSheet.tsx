import { useEffect, useState } from 'react'
import { ArrowRight, Folder, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useApp } from '../store.tsx'
import { Sheet } from './Sheet.tsx'

interface Props {
  open: boolean
  onClose: () => void
}

export function NewSessionSheet({ open, onClose }: Props) {
  const { state, actions } = useApp()
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)
  const workspace = state.config?.workspace ?? ''
  const danger = state.config?.permissionMode === 'danger-full-access'

  useEffect(() => {
    if (!open) return
    setTitle('')
    setCwd(workspace)
    setBusy(false)
  }, [open, workspace])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const session = await actions.createSession({
        ...(title.trim() !== '' ? { title: title.trim() } : {}),
        ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
      })
      if (session !== undefined) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="新对话"
      subtitle="给这一轮起个名字，并选择本机运行目录。"
      footer={
        <button className="primary-btn wide" onClick={() => void submit()} disabled={busy || cwd.trim() === ''}>
          {busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />}
          {busy ? '正在创建…' : '开始对话'}
        </button>
      }
    >
      <div className="form-stack">
        <label className="field-label" htmlFor="new-title">标题 <span>可选</span></label>
        <input
          id="new-title"
          className="text-field"
          value={title}
          placeholder="例如：修复构建失败"
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className="field-label" htmlFor="new-cwd"><Folder size={13} /> 工作目录</label>
        <input
          id="new-cwd"
          className="text-field mono-input"
          value={cwd}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setCwd(event.target.value)}
        />
        <div className={'permission-note ' + (danger ? 'danger' : '')}>
          {danger ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
          <div>
            <strong>{danger ? '完整访问权限' : '工作区写入权限'}</strong>
            <span>
              {danger
                ? '手机端可以运行不受目录限制的命令。只在你信任的设备和网络上使用。'
                : '命令和文件操作被限制在所选目录；需要提升权限的操作会被拒绝。'}
            </span>
          </div>
        </div>
        <p className="form-hint">模型：{state.config?.model ?? state.server?.model ?? 'deepseek-flash'} · 运行在本机 DSH SDK 上</p>
      </div>
    </Sheet>
  )
}
