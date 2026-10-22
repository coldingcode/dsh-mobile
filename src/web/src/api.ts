import type {
  ActivityResponse,
  Bootstrap,
  PairInfoResponse,
  PairRequestReceipt,
  PairStatusResponse,
  SessionDetail,
  SessionSummary,
  UiImageBlock,
  WsTicketResponse,
} from '../../shared/protocol.ts'
import { defaultDeviceName, nativeConfig, platformLabel } from './native.ts'

export interface PromptImage {
  data: string
  mimeType: string
  preview: string
}

export type PromptContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

let authToken: string | undefined = nativeConfig?.token

export function setAuthToken(token: string | undefined): void {
  authToken = token
}

export function hasToken(): boolean {
  return authToken !== undefined && authToken !== ''
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (authToken !== undefined && authToken !== '') headers.set('authorization', 'Bearer ' + authToken)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(new URL(path, base), {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
    })
  } catch (error) {
    throw new ApiError(0, 'network', error instanceof Error ? error.message : '网络不可用')
  }
  let body: unknown = undefined
  const text = await response.text()
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text.slice(0, 300) }
    }
  }
  if (!response.ok) {
    const record = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {}
    throw new ApiError(
      response.status,
      typeof record.error === 'string' ? record.error : 'http-' + response.status,
      typeof record.message === 'string' ? record.message : '请求失败（' + response.status + '）',
    )
  }
  return body as T
}

function origin(): string {
  return nativeConfig?.serverUrl ?? window.location.origin
}

export function health(base = origin()): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(base, '/api/health', { method: 'GET' })
}

export function pairInfo(base: string, code: string): Promise<PairInfoResponse> {
  return request<PairInfoResponse>(base, '/api/pair/info?code=' + encodeURIComponent(code), { method: 'GET' })
}

const DEVICE_KEY = 'dshm-device-id'
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing !== null && existing !== '') return existing
    const created = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    return 'web-' + Math.random().toString(36).slice(2)
  }
}

export function pairRequest(base: string, code: string): Promise<PairRequestReceipt> {
  return request<PairRequestReceipt>(base, '/api/pair/request', {
    method: 'POST',
    body: JSON.stringify({
      code,
      deviceId: deviceId(),
      deviceName: defaultDeviceName(),
      platform: platformLabel(),
      appVersion: '0.1.0',
    }),
  })
}

export function pairStatus(base: string, requestId: string): Promise<PairStatusResponse> {
  return request<PairStatusResponse>(base, '/api/pair/request/' + encodeURIComponent(requestId), { method: 'GET' })
}

export function authSession(token: string): Promise<{ ok: true; device: { id: string; name: string } }> {
  return request(origin(), '/api/auth/session', { method: 'POST', body: JSON.stringify({ token }) })
}

export function bootstrap(): Promise<Bootstrap> {
  return request<Bootstrap>(origin(), '/api/bootstrap', { method: 'GET' })
}

export function getSession(id: string): Promise<SessionDetail> {
  return request<SessionDetail>(origin(), '/api/sessions/' + encodeURIComponent(id), { method: 'GET' })
}

export function createSession(input: { title?: string; cwd?: string }): Promise<{ session: SessionSummary }> {
  return request(origin(), '/api/sessions', { method: 'POST', body: JSON.stringify(input) })
}

export function prompt(id: string, blocks: PromptContentBlock[], cwd?: string): Promise<{ ok: true; messageId: string; session: SessionSummary }> {
  return request(origin(), '/api/sessions/' + encodeURIComponent(id) + '/prompt', {
    method: 'POST',
    body: JSON.stringify({ contentBlocks: blocks, ...(cwd !== undefined ? { cwd } : {}) }),
  })
}

export function stopSession(id: string): Promise<{ ok: true; stopped: boolean }> {
  return request(origin(), '/api/sessions/' + encodeURIComponent(id) + '/stop', { method: 'POST', body: '{}' })
}

export function renameSession(id: string, title: string): Promise<{ session: SessionSummary }> {
  return request(origin(), '/api/sessions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ title }) })
}

export function deleteSession(id: string): Promise<{ ok: true }> {
  return request(origin(), '/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' })
}

export function activity(): Promise<ActivityResponse> {
  return request<ActivityResponse>(origin(), '/api/activity', { method: 'GET' })
}

export function wsTicket(): Promise<WsTicketResponse> {
  return request<WsTicketResponse>(origin(), '/api/ws-ticket', { method: 'POST', body: '{}' })
}

export function logout(): Promise<{ ok: true }> {
  return request(origin(), '/api/logout', { method: 'POST', body: '{}' })
}

export function imageBlock(image: PromptImage): PromptContentBlock {
  return { type: 'image', data: image.data, mimeType: image.mimeType }
}

export function imagePreview(block: UiImageBlock): string | undefined {
  return block.preview
}

export function wsUrl(ticket: string): string {
  const base = new URL(origin())
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return protocol + '//' + base.host + '/ws?ticket=' + encodeURIComponent(ticket)
}
