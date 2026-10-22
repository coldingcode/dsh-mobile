/**
 * Wire vocabulary shared by the DSH bridge, the mobile web client and tests.
 * Keep this module platform-neutral: it is bundled for both Node and the browser.
 */

export const PROTOCOL_VERSION = 1
export const APP_NAME = 'dsh-mobile'
export const APP_VERSION = '0.1.0'
export const PAIR_SCHEME = 'dshm'

export type PermissionMode = 'workspace-write' | 'danger-full-access'

export interface ServerInfo {
  ok: true
  app: typeof APP_NAME
  version: string
  protocol: number
  serverName: string
  platform: string
  hostname: string
  permissionMode: PermissionMode
  workspace: string
  model: string
  provider: string
}

export interface PairingPayload {
  /** Payload version. */
  v: 1
  /** Bridge origin, without a trailing slash. */
  u: string
  /** Short pairing code, formatted XXXX-XXXX. */
  c: string
  /** Human-readable server name. */
  n: string
  /** Expiry, unix milliseconds. */
  exp: number
  /** Non-secret fingerprint for display and duplicate detection. */
  f?: string
}

export interface DeviceInfo {
  id: string
  name: string
  platform: string
  createdAt: number
  lastSeenAt: number
  lastIp?: string
  current?: boolean
}

export interface PairRequestBody {
  code: string
  deviceId: string
  deviceName: string
  platform: string
  appVersion?: string
}

export interface PairRequestReceipt {
  requestId: string
  verificationCode: string
  expiresAt: number
  serverName: string
  serverUrl: string
}

export type PairRequestStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface PairStatusResponse {
  status: PairRequestStatus
  /** Present exactly once, when the request transitions to approved. */
  token?: string
  tokenExpiresAt?: number
  device?: DeviceInfo
  server?: ServerInfo
  reason?: string
}

export interface PairInfoResponse {
  serverName: string
  version: string
  platform: string
  protocol: number
  validCode: boolean
  expiresAt?: number
}

export interface UiTextBlock {
  type: 'text'
  text: string
}

export interface UiReasoningBlock {
  type: 'reasoning'
  text: string
}

export interface UiImageBlock {
  type: 'image'
  mimeType: string
  /** Small preview only; the original bytes travel separately. */
  preview?: string
  alt?: string
}

export type UiBlock = UiTextBlock | UiReasoningBlock | UiImageBlock

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
}

export interface EntryBase {
  id: string
  /** Stable display order inside one session. Updates keep their order. */
  order: number
  /** DSH session sequence that produced this entry. */
  seq: number
  ts: number
}

export interface UserEntry extends EntryBase {
  kind: 'user'
  content: UiBlock[]
}

export interface AssistantEntry extends EntryBase {
  kind: 'assistant'
  content: UiBlock[]
  usage?: Usage
  model?: string
}

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEntry extends EntryBase {
  kind: 'tool'
  callId: string
  name: string
  title: string
  args?: string
  status: ToolStatus
  output?: string
  startedAt: number
  endedAt?: number
  meta?: Record<string, string>
}

export interface NoticeEntry extends EntryBase {
  kind: 'notice'
  tone: 'info' | 'warn' | 'error'
  title: string
  detail?: string
}

export interface SubagentEntry extends EntryBase {
  kind: 'subagent'
  childId: string
  status: 'running' | 'done' | 'error'
  label?: string
  detail?: string
}

export type JournalEntry = UserEntry | AssistantEntry | ToolEntry | NoticeEntry | SubagentEntry

export interface SessionSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd: string
  model: string
  provider: string
  permissionMode: PermissionMode
  status: 'idle' | 'running' | 'error'
  running: boolean
  hasSdkSession: boolean
  entryCount: number
  lastPreview?: string
  lastError?: string
  usage: Usage
}

export interface SessionDetail {
  session: SessionSummary
  entries: JournalEntry[]
  truncated?: boolean
}

export interface WorkspaceConfig {
  serverName: string
  workspace: string
  provider: string
  model: string
  permissionMode: PermissionMode
  pairingCodeTtlSeconds: number
  allowBrowserPairing: boolean
}

export interface Bootstrap {
  protocol: number
  appVersion: string
  server: ServerInfo
  config: WorkspaceConfig
  device: DeviceInfo
  sessions: SessionSummary[]
  features: {
    images: boolean
    stop: boolean
    activity: boolean
  }
}

export interface ActivityItem {
  sessionId: string
  sessionTitle: string
  entry: ToolEntry
}

export interface ActivityResponse {
  items: ActivityItem[]
}

export type RuntimeState = 'stopped' | 'starting' | 'ready' | 'error'

export interface RuntimeStatus {
  state: RuntimeState
  message?: string
}

export type ServerEvent =
  | { type: 'hello'; protocol: number; server: ServerInfo; config: WorkspaceConfig; runtime: RuntimeStatus }
  | { type: 'session.upsert'; session: SessionSummary }
  | { type: 'session.remove'; sessionId: string }
  | { type: 'session.entry'; sessionId: string; entry: JournalEntry; session: SessionSummary }
  | { type: 'session.status'; sessionId: string; status: SessionSummary['status']; running: boolean; session: SessionSummary }
  | { type: 'runtime.status'; runtime: RuntimeStatus }
  | { type: 'pong'; time: number }

export type ClientEvent = { type: 'ping'; time: number }

export interface WsTicketResponse {
  ticket: string
  expiresAt: number
}

export interface ApiErrorShape {
  error: string
  message: string
  details?: unknown
}

export class BridgeError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.status = status
    this.code = code
  }
}

/** Encode bytes as unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** Decode unpadded base64url. Throws on malformed input. */
export function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodePairingPayload(payload: PairingPayload): string {
  const json = JSON.stringify(payload)
  return toBase64Url(new TextEncoder().encode(json))
}

export function decodePairingPayload(encoded: string): PairingPayload {
  const bytes = fromBase64Url(encoded)
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (parsed === null || typeof parsed !== 'object') throw new Error('invalid pairing payload')
  const value = parsed as Record<string, unknown>
  if (value.v !== 1) throw new Error('unsupported pairing payload version')
  if (typeof value.u !== 'string' || !/^https?:\/\//u.test(value.u)) throw new Error('invalid pairing URL')
  if (typeof value.c !== 'string' || value.c.length < 4) throw new Error('invalid pairing code')
  if (typeof value.n !== 'string') throw new Error('invalid server name')
  if (typeof value.exp !== 'number') throw new Error('invalid expiry')
  return {
    v: 1,
    u: value.u.replace(/\/+$/u, ''),
    c: value.c,
    n: value.n,
    exp: value.exp,
    ...(typeof value.f === 'string' ? { f: value.f } : {}),
  }
}

/** Build the text encoded in the pairing QR code. */
export function makePairingUri(payload: PairingPayload): string {
  return PAIR_SCHEME + '://pair?d=' + encodePairingPayload(payload)
}

/** Parse a scanned QR value. Accepts our URI and a raw encoded payload. */
export function parsePairingUri(raw: string): PairingPayload {
  const text = raw.trim()
  if (text.startsWith(PAIR_SCHEME + '://pair')) {
    const url = new URL(text)
    const encoded = url.searchParams.get('d')
    if (encoded === null || encoded === '') throw new Error('missing pairing payload')
    return decodePairingPayload(encoded)
  }
  if (text.startsWith(PAIR_SCHEME + '://')) {
    const url = new URL(text)
    const encoded = url.searchParams.get('d')
    if (encoded === null || encoded === '') throw new Error('missing pairing payload')
    return decodePairingPayload(encoded)
  }
  return decodePairingPayload(text)
}

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Format eight Crockford-ish characters as XXXX-XXXX. */
export function formatPairCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^0-9A-Z]/gu, '').replaceAll('I', '1').replaceAll('L', '1').replaceAll('O', '0').replaceAll('U', 'V')
  return clean.length === 8 ? clean.slice(0, 4) + '-' + clean.slice(4) : clean
}

export function isPairCodeChar(char: string): boolean {
  return CODE_ALPHABET.includes(char)
}

export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/gu, '').replaceAll('I', '1').replaceAll('L', '1').replaceAll('O', '0').replaceAll('U', 'V')
}

export function isPairCode(input: string): boolean {
  const code = normalizePairCode(input)
  return code.length === 8 && [...code].every(isPairCodeChar)
}

/** Copy helper shared by screens. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}
