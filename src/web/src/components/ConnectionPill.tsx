import type { RuntimeStatus } from '../../../shared/protocol.ts'
import type { SocketState } from '../ws.ts'

interface Props {
  socket: SocketState
  runtime: RuntimeStatus
  onClick?: () => void
}

export function ConnectionPill({ socket, runtime, onClick }: Props) {
  const label = socket === 'open' ? (runtime.state === 'error' ? '运行时错误' : runtime.state === 'starting' ? '正在唤醒' : '已连接') : socket === 'connecting' ? '连接中' : '离线'
  const tone = socket === 'open' ? (runtime.state === 'error' ? 'error' : runtime.state === 'starting' ? 'busy' : '') : socket === 'connecting' ? 'busy' : 'offline'
  return (
    <button className="connection-pill" onClick={onClick} aria-label="连接状态">
      <span className={'status-dot ' + tone} />
      <span>{label}</span>
    </button>
  )
}
