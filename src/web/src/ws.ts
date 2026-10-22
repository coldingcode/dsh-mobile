import type { ServerEvent } from '../../shared/protocol.ts'
import { wsTicket, wsUrl } from './api.ts'

export type SocketState = 'connecting' | 'open' | 'closed'

export class BridgeSocket {
  readonly #onEvent: (event: ServerEvent) => void
  readonly #onState: (state: SocketState) => void
  readonly #onReconnect: () => void
  #socket: WebSocket | undefined
  #closed = false
  #attempt = 0
  #timer: number | undefined
  #heartbeat: number | undefined
  #openedBefore = false
  #onlineHandler = (): void => {
    if (this.#closed) return
    if (this.#socket !== undefined && this.#socket.readyState <= WebSocket.OPEN) return
    this.#attempt = 0
    this.#schedule(0)
  }
  #offlineHandler = (): void => {
    this.#socket?.close()
  }

  constructor(callbacks: {
    onEvent: (event: ServerEvent) => void
    onState: (state: SocketState) => void
    onReconnect: () => void
  }) {
    this.#onEvent = callbacks.onEvent
    this.#onState = callbacks.onState
    this.#onReconnect = callbacks.onReconnect
  }

  start(): void {
    this.#closed = false
    window.addEventListener('online', this.#onlineHandler)
    window.addEventListener('offline', this.#offlineHandler)
    void this.#connect()
  }

  stop(): void {
    this.#closed = true
    window.removeEventListener('online', this.#onlineHandler)
    window.removeEventListener('offline', this.#offlineHandler)
    if (this.#timer !== undefined) window.clearTimeout(this.#timer)
    if (this.#heartbeat !== undefined) window.clearInterval(this.#heartbeat)
    this.#socket?.close()
    this.#socket = undefined
    this.#onState('closed')
  }

  async #connect(): Promise<void> {
    if (this.#closed) return
    this.#onState('connecting')
    try {
      const ticket = await wsTicket()
      if (this.#closed) return
      const socket = new WebSocket(wsUrl(ticket.ticket))
      this.#socket = socket
      socket.addEventListener('open', () => {
        this.#attempt = 0
        this.#onState('open')
        if (this.#openedBefore) this.#onReconnect()
        this.#openedBefore = true
        if (this.#heartbeat !== undefined) window.clearInterval(this.#heartbeat)
        this.#heartbeat = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', time: Date.now() }))
        }, 20_000)
      })
      socket.addEventListener('message', (message) => {
        try {
          const event = JSON.parse(String(message.data)) as ServerEvent
          if (event !== null && typeof event === 'object' && typeof event.type === 'string') this.#onEvent(event)
        } catch {
          /* ignore malformed frames */
        }
      })
      socket.addEventListener('close', () => {
        if (this.#heartbeat !== undefined) window.clearInterval(this.#heartbeat)
        this.#heartbeat = undefined
        if (this.#closed) return
        this.#onState('closed')
        this.#schedule()
      })
      socket.addEventListener('error', () => {
        socket.close()
      })
    } catch {
      if (this.#closed) return
      this.#onState('closed')
      this.#schedule()
    }
  }

  #schedule(ms?: number): void {
    if (this.#closed) return
    if (this.#timer !== undefined) window.clearTimeout(this.#timer)
    const delay = ms ?? Math.min(10_000, 450 * Math.pow(1.7, this.#attempt) + Math.random() * 350)
    this.#attempt += 1
    this.#timer = window.setTimeout(() => {
      this.#timer = undefined
      void this.#connect()
    }, delay)
  }
}
