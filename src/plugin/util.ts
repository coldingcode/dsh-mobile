import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiErrorShape } from '../shared/protocol.ts'
import { BridgeError } from '../shared/protocol.ts'

export function randomId(): string {
  return randomUUID()
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function sha256Short(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 12)
}

export function now(): number {
  return Date.now()
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function normalizeIp(raw: string | undefined): string {
  if (raw === undefined) return ''
  let value = raw.trim()
  if (value.startsWith('::ffff:')) value = value.slice(7)
  if (value === '::1') return '127.0.0.1'
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  return value
}

export function isLoopbackAddress(raw: string | undefined): boolean {
  const ip = normalizeIp(raw)
  return ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::1'
}

export function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 120) || 'session'
}

export async function readJsonBody<T>(req: IncomingMessage, maxBytes: number): Promise<T> {
  return readBody(req, maxBytes).then((buffer) => {
    if (buffer.length === 0) throw new BridgeError(400, 'empty-body', 'request body is empty')
    try {
      return JSON.parse(buffer.toString('utf8')) as T
    } catch {
      throw new BridgeError(400, 'invalid-json', 'request body is not valid JSON')
    }
  })
}

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) throw new BridgeError(413, 'body-too-large', 'request body is too large')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
    total += buffer.length
    if (total > maxBytes) throw new BridgeError(413, 'body-too-large', 'request body is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof BridgeError) {
    const payload: ApiErrorShape = { error: error.code, message: error.message }
    sendJson(res, error.status, payload)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { error: 'internal', message } satisfies ApiErrorShape)
}

export function sendText(res: ServerResponse, status: number, contentType: string, text: string, extra: Record<string, string> = {}): void {
  const body = Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  })
  res.end(body)
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Fixed-window in-memory limiter keyed by client identity. */
export class RateLimiter {
  readonly #limit: number
  readonly #windowMs: number
  readonly #buckets = new Map<string, { count: number; resetAt: number }>()
  constructor(limit: number, windowSeconds: number) {
    this.#limit = limit
    this.#windowMs = windowSeconds * 1000
  }
  take(key: string): boolean {
    const at = Date.now()
    const bucket = this.#buckets.get(key)
    if (bucket === undefined || bucket.resetAt <= at) {
      this.#buckets.set(key, { count: 1, resetAt: at + this.#windowMs })
      return true
    }
    if (bucket.count >= this.#limit) return false
    bucket.count += 1
    return true
  }
  reset(key: string): void {
    this.#buckets.delete(key)
  }
  prune(): void {
    const at = Date.now()
    for (const [key, bucket] of this.#buckets) if (bucket.resetAt <= at) this.#buckets.delete(key)
  }
}

/** Atomic pretty JSON write; safe across concurrent bridge instances. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n'
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + randomBytes(5).toString('hex') + '.tmp'
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return Math.max(0, Math.round(ms)) + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return minutes + 'm ' + seconds + 's'
}

export function parseArgsText(args: string | undefined): Record<string, unknown> | undefined {
  if (args === undefined || args.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(args)
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
