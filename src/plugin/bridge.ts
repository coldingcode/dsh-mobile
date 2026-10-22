import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { hostname as osHostname, networkInterfaces } from 'node:os'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { WebSocket, WebSocketServer } from 'ws'
import type {
  ActivityResponse,
  Bootstrap,
  ClientEvent,
  DeviceInfo,
  JournalEntry,
  PairRequestBody,
  PermissionMode,
  RuntimeStatus,
  ServerEvent,
  ServerInfo,
  SessionDetail,
  SessionSummary,
  WorkspaceConfig,
  WsTicketResponse,
} from '../shared/protocol.ts'
import { APP_VERSION, BridgeError, PROTOCOL_VERSION, makePairingUri } from '../shared/protocol.ts'
import type { RuntimeAdapter, RuntimeFactory } from './adapter.ts'
import type { BridgeOptions } from './config.ts'
import { APP_INFO, pickLanAddress } from './config.ts'
import { JournalStore } from './journal.ts'
import { openExternal } from './opener.ts'
import { renderPairPage } from './pair-page.ts'
import { PairingService } from './pairing.ts'
import { SdkRuntime, type PromptBlock, type RuntimeCallbacks } from './runtime.ts'
import { startQuickTunnel, type QuickTunnelHandle } from './tunnel.ts'
import {
  APP_CSP,
  PAIR_CSP,
  commonHeaders,
  fallbackManifest,
  resolvePackageFile,
  resolveWebDist,
  sendFile,
  serveWebApp,
} from './static.ts'
import {
  escapeHtml,
  formatDuration,
  hostForUrl,
  isLoopbackAddress,
  normalizeIp,
  now,
  randomToken,
  RateLimiter,
  readJsonBody,
  safeEqual,
  sendError,
  sendJson,
  sendText,
  sleep,
  truncate,
} from './util.ts'

export interface BridgeDependencies {
  runtimeFactory?: RuntimeFactory
  logger?: (line: string) => void
  appVersion?: string
  openBrowser?: (url: string) => void
  suppressOpen?: boolean
}

export interface BridgeRuntimeInfo {
  port: number
  serverUrl: string
  localUrls: string[]
  pairingUrl: string
  fingerprint: string
  tunnelUrl?: string
}

interface AuthResult {
  device: DeviceInfo
  token: string
}

interface WsTicket {
  deviceId: string
  expiresAt: number
}

interface ExtendedSocket extends WebSocket {
  alive?: boolean
}

function privateV4Score(address: string): number {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 9
  const [a = 0, b = 0] = parts
  if (a === 192 && b === 168) return 0
  if (a === 10) return 1
  if (a === 172 && b >= 16 && b <= 31) return 2
  if (a === 169 && b === 254) return 6
  return 5
}

function isDirectLoopback(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  // A local reverse proxy (cloudflared, nginx, ...) also connects from
  // loopback. Admin/pairing endpoints must stay local even when the bridge is
  // intentionally exposed through a tunnel.
  if (req.headers['cf-connecting-ip'] !== undefined) return false
  if (req.headers['x-forwarded-for'] !== undefined) return false
  if (req.headers['x-real-ip'] !== undefined) return false
  if (req.headers['forwarded'] !== undefined) return false
  return true
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (header === undefined) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

function contentBlocks(value: unknown): PromptBlock[] {
  const raw = Array.isArray(value) ? value : []
  if (raw.length === 0 || raw.length > 8) throw new BridgeError(400, 'blocks-invalid', '消息需要 1 到 8 个内容块')
  const blocks: PromptBlock[] = []
  let total = 0
  for (const item of raw) {
    if (item === null || typeof item !== 'object') throw new BridgeError(400, 'blocks-invalid', '内容块格式不正确')
    const block = item as Record<string, unknown>
    if (block.type === 'text') {
      if (typeof block.text !== 'string' || block.text.trim() === '') throw new BridgeError(400, 'text-invalid', '文本不能为空')
      if (block.text.length > 120_000) throw new BridgeError(400, 'text-too-large', '文本超过 120000 个字符')
      total += block.text.length
      blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (typeof block.data !== 'string' || typeof block.mimeType !== 'string' || !block.mimeType.startsWith('image/')) {
        throw new BridgeError(400, 'image-invalid', '图片块格式不正确')
      }
      if (block.data.length > 12_000_000) throw new BridgeError(400, 'image-too-large', '单张图片不能超过约 8 MB')
      total += block.data.length
      blocks.push({ type: 'image', data: block.data, mimeType: block.mimeType })
    } else {
      throw new BridgeError(400, 'block-unsupported', '不支持的内容块类型')
    }
  }
  if (total > 16_000_000) throw new BridgeError(400, 'prompt-too-large', '消息内容超过大小限制')
  return blocks
}

function sessionIdFromPath(pathname: string): { id: string; action?: string } | undefined {
  const match = /^\/api\/sessions\/([^/]+)(?:\/(prompt|stop))?$/u.exec(pathname)
  if (match === null) return undefined
  const id = decodeURIComponent(match[1] ?? '')
  return { id, ...(match[2] !== undefined ? { action: match[2] } : {}) }
}

/**
 * LAN bridge for dsh-mobile. Owns pairing, the durable mobile journal, the
 * phone-facing HTTP/WebSocket surface and the DSH SDK runtime child.
 */
export class MobileBridge {
  readonly #options: BridgeOptions
  readonly #deps: BridgeDependencies
  readonly #appVersion: string
  readonly #adminToken = randomToken(32)
  readonly #clients = new Set<ExtendedSocket>()
  readonly #tickets = new Map<string, WsTicket>()
  readonly #runtimeCallbacks: RuntimeCallbacks
  #pairing: PairingService | undefined
  #journal: JournalStore | undefined
  #runtime: RuntimeAdapter | undefined
  #runtimeStatus: RuntimeStatus = { state: 'stopped' }
  #server: Server | undefined
  #wss: WebSocketServer | undefined
  #tunnel: QuickTunnelHandle | undefined
  #tunnelUrl: string | undefined
  #port = 0
  #started = false
  #stopping = false
  #pingTimer: NodeJS.Timeout | undefined
  #openTimer: NodeJS.Timeout | undefined
  #webDist = ''
  #pairRateLimiter: RateLimiter | undefined

  constructor(options: BridgeOptions, deps: BridgeDependencies = {}) {
    this.#options = options
    this.#deps = deps
    this.#appVersion = deps.appVersion ?? APP_VERSION
    this.#webDist = resolveWebDist(options.webDist)
    this.#runtimeCallbacks = {
      onSessionEvent: (sessionId, event) => this.#onSessionEvent(sessionId, event),
      onSessionStatus: (sessionId, status) => this.#onSessionStatus(sessionId, status),
      onSubagentStarted: (parentSessionId, childSessionId) => this.#onSubagentStarted(parentSessionId, childSessionId),
      onSubagentFinished: (payload) => this.#onSubagentFinished(payload),
      onStatus: (status) => this.#setRuntimeStatus(status),
      onLog: (line, stream) => {
        if (line.trim() === '') return
        this.#log('[runtime:' + stream + '] ' + truncate(line, 1200))
      },
    }
  }

  get port(): number {
    return this.#port
  }

  get serverUrl(): string {
    return this.#serverUrl()
  }

  get pairingUrl(): string {
    return this.#pairingPageUrl()
  }

  get adminToken(): string {
    return this.#adminToken
  }

  get journal(): JournalStore | undefined {
    return this.#journal
  }

  get runtimeStatus(): RuntimeStatus {
    return { ...this.#runtimeStatus }
  }

  async start(): Promise<BridgeRuntimeInfo> {
    if (this.#started) throw new Error('bridge already started')
    await mkdir(this.#options.stateDir, { recursive: true })
    const pairing = new PairingService({
      serverName: this.#options.serverName,
      stateDir: this.#options.stateDir,
      codeTtlSeconds: this.#options.pairingCodeTtlSeconds,
      requestTtlSeconds: this.#options.pairRequestTtlSeconds,
      autoApprove: this.#options.autoApprove,
      appVersion: this.#appVersion,
      serverUrl: () => this.#serverUrl(),
    })
    await pairing.load()
    this.#pairing = pairing
    const journal = new JournalStore({
      stateDir: this.#options.stateDir,
      workspace: this.#options.workspace,
      provider: this.#options.provider,
      model: this.#options.model,
      permissionMode: this.#options.permissionMode,
    })
    await journal.load()
    this.#journal = journal
    const factory: RuntimeFactory = this.#deps.runtimeFactory ?? ((callbacks) => new SdkRuntime({
      workspace: this.#options.workspace,
      provider: this.#options.provider,
      model: this.#options.model,
      permissionMode: this.#options.permissionMode,
      ...(this.#options.sdkCommand !== undefined ? { sdkCommand: this.#options.sdkCommand } : {}),
      ...(this.#options.sdkArgs !== undefined ? { sdkArgs: this.#options.sdkArgs } : {}),
    }, callbacks))
    this.#runtime = factory(this.#runtimeCallbacks)
    this.#pairRateLimiter = new RateLimiter(this.#options.maxPairAttempts, this.#options.pairAttemptWindowSeconds)
    this.#wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 })
    const port = await this.#listen()
    this.#port = port
    if (this.#options.tunnelMode === 'quick' && this.#options.publicUrl === undefined) {
      this.#log('starting Cloudflare quick tunnel (traffic is relayed through Cloudflare)')
      try {
        this.#tunnel = await startQuickTunnel({
          binary: this.#options.cloudflaredBinary,
          localUrl: 'http://127.0.0.1:' + String(port),
          timeoutMs: 30_000,
        })
        this.#tunnelUrl = this.#tunnel.url
        this.#log('quick tunnel ready: ' + this.#tunnelUrl)
      } catch (error) {
        this.#log('quick tunnel failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    this.#started = true
    this.#pingTimer = setInterval(() => this.#tick(), 25_000)
    this.#pingTimer.unref?.()
    this.#log('bridge ready on ' + this.#serverUrl() + ' (bind ' + this.#options.bindHost + ':' + String(port) + ')')
    this.#log('permission=' + this.#options.permissionMode + ' workspace=' + this.#options.workspace)
    this.#log('pairing page: ' + this.#pairingPageUrl())
    const urls = this.#localUrls()
    if (urls.length > 1) this.#log('phone URLs: ' + urls.join('  '))
    if (this.#advertisedHost() === '127.0.0.1' && this.#tunnelUrl === undefined && this.#options.publicUrl === undefined) {
      this.#log('warning: no LAN address was detected. Join the phone to the same network, set publicUrl, or enable tunnelMode: quick.')
    }
    if (this.#options.printTerminalQr) void this.#printTerminalQr()
    if (this.#options.openPairingPage && this.#deps.suppressOpen !== true) {
      this.#openTimer = setTimeout(() => {
        const opener = this.#deps.openBrowser ?? openExternal
        try {
          opener(this.#pairingPageUrl())
        } catch {
          /* best effort */
        }
      }, 1000)
      this.#openTimer.unref?.()
    }
    return {
      port,
      serverUrl: this.#serverUrl(),
      localUrls: urls,
      pairingUrl: this.#pairingPageUrl(),
      fingerprint: pairing.fingerprint,
      ...(this.#tunnelUrl !== undefined ? { tunnelUrl: this.#tunnelUrl } : {}),
    }
  }

  async stop(): Promise<void> {
    if (this.#stopping) return
    this.#stopping = true
    if (this.#pingTimer !== undefined) clearInterval(this.#pingTimer)
    if (this.#openTimer !== undefined) clearTimeout(this.#openTimer)
    this.#pingTimer = undefined
    this.#openTimer = undefined
    for (const client of this.#clients) {
      try {
        client.close(1001, 'bridge stopping')
      } catch {
        /* ignore */
      }
    }
    this.#clients.clear()
    this.#wss?.close()
    this.#wss = undefined
    const server = this.#server
    this.#server = undefined
    if (server !== undefined) {
      await new Promise<void>((resolveDone) => {
        const timer = setTimeout(resolveDone, 2000)
        timer.unref?.()
        server.close(() => {
          clearTimeout(timer)
          resolveDone()
        })
        server.closeAllConnections?.()
      })
    }
    try {
      await this.#tunnel?.stop()
    } catch {
      /* ignore */
    }
    this.#tunnel = undefined
    this.#tunnelUrl = undefined
    try {
      await this.#runtime?.stop()
    } catch {
      /* ignore */
    }
    this.#runtime = undefined
    try {
      await this.#journal?.flush()
    } catch {
      /* ignore */
    }
    try {
      await this.#pairing?.flush()
    } catch {
      /* ignore */
    }
    this.#pairing?.dispose()
    this.#pairing = undefined
    this.#started = false
    this.#stopping = false
  }

  // ---------------------------------------------------------------------
  // runtime events
  // ---------------------------------------------------------------------

  #onSessionEvent(sessionId: string, event: { type: string; seq: number; time: number; data?: unknown }): void {
    const journal = this.#journal
    if (journal === undefined) return
    const before = journal.summary(sessionId)
    if (before === undefined) return
    let changed: JournalEntry[] = []
    try {
      changed = journal.applyEvent(sessionId, event)
    } catch (error) {
      this.#log('journal apply failed: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    const after = journal.summary(sessionId)
    if (after === undefined) return
    for (const entry of changed) this.#broadcast({ type: 'session.entry', sessionId, entry, session: after })
    if (before.status !== after.status || before.running !== after.running) {
      this.#broadcast({ type: 'session.status', sessionId, status: after.status, running: after.running, session: after })
    }
    this.#broadcast({ type: 'session.upsert', session: after })
  }

  #onSessionStatus(sessionId: string, status: 'running' | 'idle'): void {
    const journal = this.#journal
    if (journal === undefined) return
    if (journal.summary(sessionId) === undefined) return
    const session = journal.setStatus(sessionId, status)
    this.#broadcast({ type: 'session.status', sessionId, status: session.status, running: session.running, session })
    this.#broadcast({ type: 'session.upsert', session })
  }

  #onSubagentStarted(parentSessionId: string, childSessionId: string): void {
    const journal = this.#journal
    if (journal === undefined) return
    const session = journal.summary(parentSessionId)
    if (session === undefined) return
    const entry = journal.subagentStarted(parentSessionId, childSessionId, session.entryCount, now())
    const after = journal.summary(parentSessionId)
    if (entry !== undefined && after !== undefined) this.#broadcast({ type: 'session.entry', sessionId: parentSessionId, entry, session: after })
  }

  #onSubagentFinished(payload: {
    agentId: string
    parentSessionId: string
    childSessionId: string
    status: 'ok' | 'error'
    lastAssistantMessage?: string[]
  }): void {
    const journal = this.#journal
    if (journal === undefined) return
    const session = journal.summary(payload.parentSessionId)
    if (session === undefined) return
    const detail = payload.lastAssistantMessage?.join('\n')
    const entry = journal.subagentFinished(payload.parentSessionId, payload.childSessionId, payload.status === 'ok', detail, session.entryCount, now())
    const after = journal.summary(payload.parentSessionId)
    if (entry !== undefined && after !== undefined) this.#broadcast({ type: 'session.entry', sessionId: payload.parentSessionId, entry, session: after })
  }

  #setRuntimeStatus(status: RuntimeStatus): void {
    this.#runtimeStatus = { ...status }
    this.#broadcast({ type: 'runtime.status', runtime: this.#runtimeStatus })
    if (status.state === 'error') {
      const journal = this.#journal
      if (journal !== undefined) {
        for (const summary of journal.list()) {
          if (!summary.running) continue
          const failed = journal.setStatus(summary.id, 'error', status.message ?? 'runtime failed')
          journal.addNotice(summary.id, 'error', '运行中断', status.message)
          this.#broadcast({ type: 'session.status', sessionId: summary.id, status: failed.status, running: failed.running, session: failed })
          this.#broadcast({ type: 'session.upsert', session: failed })
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------

  async #listen(): Promise<number> {
    const requested = this.#options.port
    const candidates: number[] = requested === 0 ? [0] : [requested]
    if (requested !== 0) {
      for (let offset = 1; offset <= 9 && requested + offset <= 65535; offset += 1) candidates.push(requested + offset)
      candidates.push(0)
    }
    let lastError: Error | undefined
    for (const candidate of candidates) {
      const server = this.#createServer()
      try {
        const port = await new Promise<number>((resolvePort, rejectPort) => {
          const onError = (error: NodeJS.ErrnoException) => {
            server.off('listening', onListening)
            rejectPort(error)
          }
          const onListening = () => {
            server.off('error', onError)
            const address = server.address()
            resolvePort(typeof address === 'object' && address !== null ? (address as AddressInfo).port : candidate)
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(candidate, this.#options.bindHost)
        })
        this.#server = server
        return port
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        try {
          server.close()
        } catch {
          /* ignore */
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
        if (candidate !== 0) this.#log('port ' + String(candidate) + ' unavailable, trying next')
      }
    }
    throw lastError ?? new Error('unable to bind the dsh-mobile bridge')
  }

  #createServer(): Server {
    const server = createServer((req, res) => {
      void this.#handle(req, res).catch((error: unknown) => {
        this.#log('request failed: ' + (error instanceof Error ? error.message : String(error)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        try {
          sendError(res, error)
        } catch {
          res.destroy()
        }
      })
    })
    server.keepAliveTimeout = 65_000
    server.headersTimeout = 70_000
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => this.#handleUpgrade(req, socket, head))
    server.on('clientError', (error, socket) => {
      if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      this.#log('client error: ' + error.message)
    })
    return server
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [key, value] of Object.entries(commonHeaders())) res.setHeader(key, value)
    res.setHeader('x-dsh-mobile-version', this.#appVersion)
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://bridge.local')
    } catch {
      sendText(res, 400, 'text/plain; charset=utf-8', 'bad request')
      return
    }
    const pathname = url.pathname
    const method = req.method ?? 'GET'
    const ip = normalizeIp(req.socket.remoteAddress)

    if (pathname === '/api/health' && (method === 'GET' || method === 'HEAD')) {
      sendJson(res, 200, this.#serverInfo())
      return
    }
    if (pathname === '/api/pair/info' && method === 'GET') {
      if (!this.#takePairAttempt('info:' + ip)) return
      const info = this.#pairing?.info(url.searchParams.get('code') ?? undefined)
      sendJson(res, 200, { ...info, version: this.#appVersion })
      return
    }
    if (pathname === '/api/pair/request' && method === 'POST') {
      if (!this.#takePairAttempt('request:' + ip)) return
      const body = await readJsonBody<PairRequestBody>(req, this.#options.maxBodyBytes)
      const receipt = this.#pairing?.createRequest(body, ip)
      sendJson(res, 200, receipt)
      return
    }
    const pairStatusMatch = /^\/api\/pair\/request\/([^/]+)$/u.exec(pathname)
    if (pairStatusMatch !== null && method === 'GET') {
      const id = decodeURIComponent(pairStatusMatch[1] ?? '')
      sendJson(res, 200, this.#pairing?.status(id))
      return
    }
    if (pathname === '/api/auth/session' && method === 'POST') {
      const body = await readJsonBody<{ token?: unknown }>(req, 1024 * 1024)
      if (typeof body.token !== 'string') throw new BridgeError(400, 'token-required', 'token is required')
      const device = this.#pairing?.authenticate(body.token)
      if (device === undefined) throw new BridgeError(401, 'invalid-token', '设备令牌无效或已过期')
      res.setHeader('set-cookie', this.#cookie(body.token, req, 180 * 24 * 60 * 60))
      sendJson(res, 200, { ok: true, device: { ...device, current: true }, server: this.#serverInfo() })
      return
    }
    if (pathname === '/api/bootstrap' && method === 'GET') {
      const auth = this.#auth(req)
      sendJson(res, 200, this.#bootstrap(auth))
      return
    }
    if (pathname === '/api/logout' && method === 'POST') {
      const auth = this.#auth(req)
      this.#pairing?.revoke(auth.device.id)
      res.setHeader('set-cookie', this.#cookie('', req, 0))
      sendJson(res, 200, { ok: true })
      return
    }
    if (pathname === '/api/ws-ticket' && method === 'POST') {
      const auth = this.#auth(req)
      const ticket = randomToken(24)
      this.#tickets.set(ticket, { deviceId: auth.device.id, expiresAt: now() + 30_000 })
      sendJson(res, 200, { ticket, expiresAt: now() + 30_000 } satisfies WsTicketResponse)
      return
    }
    if (pathname === '/api/sessions' && method === 'GET') {
      this.#auth(req)
      sendJson(res, 200, { sessions: this.#journal?.list() ?? [] })
      return
    }
    if (pathname === '/api/sessions' && method === 'POST') {
      this.#auth(req)
      const body = await readJsonBody<{ title?: unknown; cwd?: unknown }>(req, 1024 * 1024)
      const title = typeof body.title === 'string' ? body.title : undefined
      let cwd: string | undefined
      if (typeof body.cwd === 'string' && body.cwd.trim() !== '') {
        cwd = resolve(body.cwd)
        const info = await stat(cwd).catch(() => undefined)
        if (info === undefined || !info.isDirectory()) throw new BridgeError(400, 'cwd-invalid', '工作目录不存在或不是文件夹')
      }
      const session = this.#journal?.create({ ...(title !== undefined ? { title } : {}), ...(cwd !== undefined ? { cwd } : {}) })
      if (session === undefined) throw new BridgeError(500, 'journal-missing', '会话存储尚未就绪')
      this.#broadcast({ type: 'session.upsert', session })
      sendJson(res, 200, { session })
      return
    }
    if (pathname === '/api/activity' && method === 'GET') {
      this.#auth(req)
      const response: ActivityResponse = { items: this.#journal?.activity(120) ?? [] }
      sendJson(res, 200, response)
      return
    }
    const sessionPath = sessionIdFromPath(pathname)
    if (sessionPath !== undefined) {
      this.#auth(req)
      if (sessionPath.action === 'prompt' && method === 'POST') {
        const body = await readJsonBody<{ text?: unknown; contentBlocks?: unknown; blocks?: unknown; cwd?: unknown }>(req, this.#options.maxBodyBytes)
        const blocks = contentBlocks(body.contentBlocks ?? body.blocks ?? (typeof body.text === 'string' ? [{ type: 'text', text: body.text }] : []))
        const result = await this.#prompt(sessionPath.id, blocks, typeof body.cwd === 'string' ? body.cwd : undefined)
        sendJson(res, 200, result)
        return
      }
      if (sessionPath.action === 'stop' && method === 'POST') {
        const result = await this.#stop(sessionPath.id)
        sendJson(res, 200, result)
        return
      }
      if (sessionPath.action === undefined && method === 'GET') {
        const detail = this.#journal?.get(sessionPath.id)
        if (detail === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
        sendJson(res, 200, detail satisfies SessionDetail)
        return
      }
      if (sessionPath.action === undefined && method === 'PATCH') {
        const body = await readJsonBody<{ title?: unknown }>(req, 1024 * 1024)
        if (typeof body.title !== 'string') throw new BridgeError(400, 'title-required', 'title is required')
        const session = this.#journal?.rename(sessionPath.id, body.title)
        if (session === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
        this.#broadcast({ type: 'session.upsert', session })
        sendJson(res, 200, { session })
        return
      }
      if (sessionPath.action === undefined && method === 'DELETE') {
        const summary = this.#journal?.summary(sessionPath.id)
        if (summary === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
        if (summary.running) throw new BridgeError(409, 'session-running', '运行中的会话不能移除')
        this.#journal?.delete(sessionPath.id)
        this.#broadcast({ type: 'session.remove', sessionId: sessionPath.id })
        sendJson(res, 200, { ok: true })
        return
      }
    }

    if (pathname === '/pair' && method === 'GET') {
      this.#servePairPage(req, res, url)
      return
    }
    if (pathname.startsWith('/admin/') && (method === 'GET' || method === 'POST')) {
      await this.#handleAdmin(req, res, url, method)
      return
    }
    if (pathname === '/icon.png' || pathname === '/apple-touch-icon.png' || pathname === '/favicon.ico') {
      const icon = resolvePackageFile('assets/icon.png')
      if (icon !== undefined && await sendFile(req, res, icon, 'public, max-age=86400', 'image/png')) return
      res.writeHead(404, commonHeaders())
      res.end()
      return
    }
    if (pathname === '/manifest.webmanifest') {
      const manifest = resolve(this.#webDist, 'manifest.webmanifest')
      if (await sendFile(req, res, manifest, 'no-cache', 'application/manifest+json; charset=utf-8')) return
      sendText(res, 200, 'application/manifest+json; charset=utf-8', fallbackManifest(this.#options.serverName), { 'cache-control': 'no-cache' })
      return
    }
    if (pathname === '/robots.txt') {
      sendText(res, 200, 'text/plain; charset=utf-8', 'User-agent: *\nDisallow: /\n', { 'cache-control': 'no-store' })
      return
    }
    if (pathname.startsWith('/api/')) {
      throw new BridgeError(404, 'not-found', '接口不存在')
    }
    await serveWebApp(req, res, this.#webDist)
  }

  #servePairPage(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!isDirectLoopback(req)) {
      sendText(res, 403, 'text/plain; charset=utf-8', '配对页只能在本机打开。')
      return
    }
    const token = url.searchParams.get('admin') ?? ''
    if (!safeEqual(token, this.#adminToken)) {
      sendText(res, 401, 'text/plain; charset=utf-8', '配对页令牌无效。请使用 DSH 日志中打印的配对链接。', { 'content-security-policy': PAIR_CSP })
      return
    }
    const html = renderPairPage({
      serverName: this.#options.serverName,
      serverUrl: this.#serverUrl(),
      fingerprint: this.#pairing?.fingerprint ?? '',
      appVersion: this.#appVersion,
    })
    sendText(res, 200, 'text/html; charset=utf-8', html, {
      'content-security-policy': PAIR_CSP,
      'cache-control': 'no-store',
    })
  }

  async #handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
    if (!isDirectLoopback(req)) throw new BridgeError(403, 'loopback-only', '管理接口只允许本机访问')
    const token = url.searchParams.get('admin') ?? (typeof req.headers['x-dsh-mobile-admin'] === 'string' ? req.headers['x-dsh-mobile-admin'] : '')
    if (!safeEqual(token, this.#adminToken)) throw new BridgeError(401, 'admin-unauthorized', '管理令牌无效')
    const pairing = this.#pairing
    if (pairing === undefined) throw new BridgeError(503, 'pairing-missing', '配对服务尚未就绪')
    const pathname = url.pathname
    if (pathname === '/admin/state' && method === 'GET') {
      sendJson(res, 200, { ...pairing.adminState(), codeTtlSeconds: this.#options.pairingCodeTtlSeconds, serverNow: now() })
      return
    }
    if (pathname === '/admin/qr.svg' && method === 'GET') {
      const uri = makePairingUri(pairing.payload())
      const svg = await QRCode.toString(uri, {
        type: 'svg',
        margin: 1,
        width: 560,
        errorCorrectionLevel: 'M',
        color: { dark: '#101018', light: '#ffffff' },
      })
      sendText(res, 200, 'image/svg+xml; charset=utf-8', svg, { 'content-security-policy': PAIR_CSP, 'cache-control': 'no-store' })
      return
    }
    if (pathname === '/admin/rotate' && method === 'POST') {
      pairing.rotateCode()
      sendJson(res, 200, { ok: true, ...pairing.adminState(), codeTtlSeconds: this.#options.pairingCodeTtlSeconds, serverNow: now() })
      return
    }
    const approveMatch = /^\/admin\/requests\/([^/]+)\/(approve|deny)$/u.exec(pathname)
    if (approveMatch !== null && method === 'POST') {
      const id = decodeURIComponent(approveMatch[1] ?? '')
      if (approveMatch[2] === 'approve') {
        const result = pairing.approve(id)
        this.#log('paired device: ' + result.device.name + ' (' + result.device.platform + ')')
        sendJson(res, 200, { ok: true, device: result.device })
      } else {
        pairing.deny(id)
        sendJson(res, 200, { ok: true })
      }
      return
    }
    const revokeMatch = /^\/admin\/devices\/([^/]+)\/revoke$/u.exec(pathname)
    if (revokeMatch !== null && method === 'POST') {
      pairing.revoke(decodeURIComponent(revokeMatch[1] ?? ''))
      sendJson(res, 200, { ok: true })
      return
    }
    throw new BridgeError(404, 'admin-not-found', '管理接口不存在')
  }

  // ---------------------------------------------------------------------
  // session actions
  // ---------------------------------------------------------------------

  async #prompt(sessionId: string, blocks: PromptBlock[], requestedCwd: string | undefined): Promise<{ ok: true; messageId: string; session: SessionSummary }> {
    const journal = this.#journal
    const runtime = this.#runtime
    if (journal === undefined || runtime === undefined) throw new BridgeError(503, 'not-ready', '桥接服务尚未就绪')
    const before = journal.summary(sessionId)
    if (before === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
    if (before.running) throw new BridgeError(409, 'session-running', '这个会话正在运行，请等待完成')
    let cwd = before.cwd
    if (requestedCwd !== undefined && requestedCwd.trim() !== '') {
      cwd = resolve(requestedCwd)
      const info = await stat(cwd).catch(() => undefined)
      if (info === undefined || !info.isDirectory()) throw new BridgeError(400, 'cwd-invalid', '工作目录不存在或不是文件夹')
      journal.setCwd(sessionId, cwd)
    }
    const running = journal.setStatus(sessionId, 'running')
    this.#broadcast({ type: 'session.status', sessionId, status: 'running', running: true, session: running })
    this.#broadcast({ type: 'session.upsert', session: running })
    try {
      const current = journal.summary(sessionId)
      if (current === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
      if (!current.hasSdkSession && current.cwd !== this.#options.workspace) {
        await runtime.setWorkingDirectory(sessionId, current.cwd)
        journal.markSdkSession(sessionId)
      }
      const resume = journal.summary(sessionId)?.hasSdkSession === true
      const messageId = await runtime.prompt(sessionId, blocks, resume)
      journal.markSdkSession(sessionId)
      const session = journal.touch(sessionId)
      this.#broadcast({ type: 'session.upsert', session })
      return { ok: true, messageId, session }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = journal.setStatus(sessionId, 'error', message)
      const notice = journal.addNotice(sessionId, 'error', '无法开始运行', truncate(message, 2000))
      this.#broadcast({ type: 'session.entry', sessionId, entry: notice, session: failed })
      this.#broadcast({ type: 'session.status', sessionId, status: failed.status, running: failed.running, session: failed })
      this.#broadcast({ type: 'session.upsert', session: failed })
      throw new BridgeError(502, 'prompt-failed', message)
    }
  }

  async #stop(sessionId: string): Promise<{ ok: true; stopped: boolean }> {
    const journal = this.#journal
    const runtime = this.#runtime
    if (journal === undefined || runtime === undefined) throw new BridgeError(503, 'not-ready', '桥接服务尚未就绪')
    const session = journal.summary(sessionId)
    if (session === undefined) throw new BridgeError(404, 'session-not-found', '会话不存在')
    const running = journal.list().filter((entry) => entry.running)
    if (running.length === 0) return { ok: true, stopped: false }
    try {
      await runtime.restart()
      for (const entry of running) {
        const idle = journal.setStatus(entry.id, 'idle')
        const notice = journal.addNotice(entry.id, 'info', '已停止', entry.id === sessionId ? '这一轮运行已被你中断。' : '运行时重启，所有进行中的会话都已中断。')
        this.#broadcast({ type: 'session.entry', sessionId: entry.id, entry: notice, session: idle })
        this.#broadcast({ type: 'session.status', sessionId: entry.id, status: idle.status, running: idle.running, session: idle })
        this.#broadcast({ type: 'session.upsert', session: idle })
      }
      return { ok: true, stopped: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const entry of running) {
        const failed = journal.setStatus(entry.id, 'error', message)
        this.#broadcast({ type: 'session.status', sessionId: entry.id, status: failed.status, running: failed.running, session: failed })
        this.#broadcast({ type: 'session.upsert', session: failed })
      }
      throw new BridgeError(502, 'stop-failed', '无法停止运行时：' + message)
    }
  }

  // ---------------------------------------------------------------------
  // auth and payloads
  // ---------------------------------------------------------------------

  #token(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim()
    const cookies = parseCookies(req.headers.cookie)
    return cookies.dshm_session
  }

  #auth(req: IncomingMessage): AuthResult {
    const token = this.#token(req)
    if (token === undefined) throw new BridgeError(401, 'unauthorized', '需要配对令牌')
    const device = this.#pairing?.authenticate(token)
    if (device === undefined) throw new BridgeError(401, 'unauthorized', '配对令牌无效或已过期')
    return { device, token }
  }

  #bootstrap(auth: AuthResult): Bootstrap {
    return {
      protocol: PROTOCOL_VERSION,
      appVersion: this.#appVersion,
      server: this.#serverInfo(),
      config: this.#workspaceConfig(),
      device: { ...auth.device, current: true },
      sessions: this.#journal?.list() ?? [],
      features: { images: true, stop: true, activity: true },
    }
  }

  #serverInfo(): ServerInfo {
    return {
      ok: true,
      app: 'dsh-mobile',
      version: this.#appVersion,
      protocol: PROTOCOL_VERSION,
      serverName: this.#options.serverName,
      platform: process.platform,
      hostname: osHostname(),
      permissionMode: this.#options.permissionMode,
      workspace: this.#options.workspace,
      model: this.#options.model,
      provider: this.#options.provider,
    }
  }

  #workspaceConfig(): WorkspaceConfig {
    return {
      serverName: this.#options.serverName,
      workspace: this.#options.workspace,
      provider: this.#options.provider,
      model: this.#options.model,
      permissionMode: this.#options.permissionMode,
      pairingCodeTtlSeconds: this.#options.pairingCodeTtlSeconds,
      allowBrowserPairing: this.#options.allowBrowserPairing,
    }
  }

  #cookie(token: string, req: IncomingMessage, maxAge: number): string {
    const secure = this.#secureRequest(req)
    return 'dshm_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + String(maxAge) + (secure ? '; Secure' : '')
  }

  #secureRequest(req: IncomingMessage): boolean {
    if ((req.socket as Socket & { encrypted?: boolean }).encrypted === true) return true
    const forwarded = req.headers['x-forwarded-proto']
    if (typeof forwarded === 'string' && forwarded.split(',')[0]?.trim() === 'https') return true
    return this.#options.publicUrl?.startsWith('https://') === true
  }

  #takePairAttempt(key: string): boolean {
    const limiter = this.#pairRateLimiter
    if (limiter === undefined) return true
    if (!limiter.take(key)) throw new BridgeError(429, 'pair-rate-limited', '配对尝试过于频繁，请稍后再试')
    return true
  }

  #serverUrl(): string {
    if (this.#tunnelUrl !== undefined) return this.#tunnelUrl
    if (this.#options.publicUrl !== undefined) return this.#options.publicUrl
    return 'http://' + hostForUrl(this.#advertisedHost()) + ':' + String(this.#port)
  }

  #advertisedHost(): string {
    const bind = this.#options.bindHost
    if (bind === '0.0.0.0' || bind === '::' || bind === '') return pickLanAddress()
    if (bind === '127.0.0.1' || bind === '::1' || bind === 'localhost') return '127.0.0.1'
    return bind
  }

  #localUrls(): string[] {
    const urls: string[] = []
    if (this.#tunnelUrl !== undefined) urls.push(this.#tunnelUrl)
    if (this.#options.publicUrl !== undefined) urls.push(this.#options.publicUrl)
    urls.push('http://127.0.0.1:' + String(this.#port))
    const interfaces = networkInterfaces()
    const candidates: Array<{ address: string; family: string; score: number }> = []
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.internal) continue
        if (entry.family === 'IPv4') candidates.push({ address: entry.address, family: 'IPv4', score: privateV4Score(entry.address) })
        else if (entry.family === 'IPv6' && !entry.address.startsWith('fe80:') && entry.address !== '::1') {
          candidates.push({ address: entry.address, family: 'IPv6', score: 3 })
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score)
    for (const candidate of candidates) {
      const url = 'http://' + hostForUrl(candidate.address) + ':' + String(this.#port)
      if (!urls.includes(url)) urls.push(url)
    }
    return urls
  }

  #pairingPageUrl(): string {
    return 'http://127.0.0.1:' + String(this.#port) + '/pair?admin=' + encodeURIComponent(this.#adminToken)
  }

  // ---------------------------------------------------------------------
  // websocket
  // ---------------------------------------------------------------------

  #handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://bridge.local')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    const ticket = url.searchParams.get('ticket')
    const entry = ticket === null ? undefined : this.#tickets.get(ticket)
    if (ticket !== null && entry !== undefined) this.#tickets.delete(ticket)
    if (entry === undefined || entry.expiresAt <= now()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && origin !== 'null' && origin !== '') {
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = ''
      }
      if (originHost !== '' && originHost !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    }
    this.#wss?.handleUpgrade(req, socket, head, (ws) => {
      this.#onWsConnection(ws as ExtendedSocket, entry.deviceId)
    })
  }

  #onWsConnection(ws: ExtendedSocket, _deviceId: string): void {
    ws.alive = true
    this.#clients.add(ws)
    ws.on('pong', () => {
      ws.alive = true
    })
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as ClientEvent
        if (event.type === 'ping') this.#send(ws, { type: 'pong', time: now() })
      } catch {
        /* ignore malformed client frames */
      }
    })
    ws.on('close', () => {
      this.#clients.delete(ws)
    })
    ws.on('error', () => {
      this.#clients.delete(ws)
    })
    this.#send(ws, {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      server: this.#serverInfo(),
      config: this.#workspaceConfig(),
      runtime: this.#runtimeStatus,
    })
    for (const session of this.#journal?.list() ?? []) {
      this.#send(ws, { type: 'session.upsert', session })
    }
  }

  #send(ws: ExtendedSocket, event: ServerEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(event))
    } catch {
      this.#clients.delete(ws)
    }
  }

  #broadcast(event: ServerEvent): void {
    if (this.#clients.size === 0) return
    const payload = JSON.stringify(event)
    for (const ws of this.#clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.#clients.delete(ws)
        continue
      }
      if (ws.bufferedAmount > 4 * 1024 * 1024) {
        ws.terminate()
        this.#clients.delete(ws)
        continue
      }
      try {
        ws.send(payload)
      } catch {
        this.#clients.delete(ws)
      }
    }
  }

  #tick(): void {
    for (const ws of this.#clients) {
      if (ws.alive === false) {
        ws.terminate()
        this.#clients.delete(ws)
        continue
      }
      ws.alive = false
      try {
        ws.ping()
      } catch {
        this.#clients.delete(ws)
      }
    }
    const at = now()
    for (const [ticket, entry] of this.#tickets) if (entry.expiresAt <= at) this.#tickets.delete(ticket)
    this.#pairRateLimiter?.prune()
    this.#pairing?.prune()
  }

  // ---------------------------------------------------------------------
  // misc
  // ---------------------------------------------------------------------

  async #printTerminalQr(): Promise<void> {
    const pairing = this.#pairing
    if (pairing === undefined) return
    try {
      const qr = await QRCode.toString(makePairingUri(pairing.payload()), { type: 'terminal', small: true, margin: 1 })
      this.#log('scan this QR with dsh-mobile:\n' + qr)
    } catch {
      /* terminal QR is optional */
    }
  }

  #log(line: string): void {
    const logger = this.#deps.logger
    if (logger !== undefined) logger('[dsh-mobile] ' + line)
    else console.log('[dsh-mobile] ' + line)
  }
}

export const BRIDGE_INFO = { name: APP_INFO.name, version: APP_INFO.version }
export { formatDuration, escapeHtml }
