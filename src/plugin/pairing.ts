import { createHash, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  DeviceInfo,
  PairInfoResponse,
  PairRequestReceipt,
  PairRequestBody,
  PairStatusResponse,
  PairingPayload,
} from '../shared/protocol.ts'
import { BridgeError, formatPairCode, isPairCode, normalizePairCode } from '../shared/protocol.ts'
import { hashToken, now, randomToken, safeEqual, sha256Short, truncate, writeJsonAtomic } from './util.ts'

interface StoredDevice {
  id: string
  name: string
  platform: string
  tokenHash: string
  createdAt: number
  lastSeenAt: number
  lastIp?: string
  expiresAt: number
}

interface DeviceFile {
  version: 1
  devices: StoredDevice[]
}

interface PendingRequest {
  id: string
  verificationCode: string
  deviceId: string
  deviceName: string
  platform: string
  appVersion?: string
  ip: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'approved' | 'denied' | 'expired'
  token?: string
  device?: StoredDevice
  tokenDelivered?: boolean
}

export interface PairingOptions {
  serverName: string
  stateDir: string
  codeTtlSeconds: number
  requestTtlSeconds: number
  autoApprove: boolean
  appVersion: string
  serverUrl: () => string
}

export interface AdminPendingView {
  id: string
  verificationCode: string
  deviceName: string
  platform: string
  appVersion?: string
  ip: string
  createdAt: number
  expiresAt: number
  status: string
}

export interface AdminState {
  serverName: string
  serverUrl: string
  pairCode: string
  codeExpiresAt: number
  codeTtlSeconds: number
  serverNow: number
  pending: AdminPendingView[]
  devices: DeviceInfo[]
  fingerprint: string
}

const TOKEN_PREFIX = 'dshm_'
const DEVICE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function newPairCode(): string {
  let value = ''
  for (let i = 0; i < 8; i += 1) value += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return value
}

function newVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function codeEquals(a: string, b: string): boolean {
  const left = Buffer.from(normalizePairCode(a))
  const right = Buffer.from(normalizePairCode(b))
  return left.length === right.length && left.length > 0 && safeEqual(left.toString('latin1'), right.toString('latin1'))
}

export class PairingService {
  readonly #options: PairingOptions
  readonly #devicesPath: string
  readonly #statePath: string
  #devices: StoredDevice[] = []
  #pending = new Map<string, PendingRequest>()
  #code = ''
  #codeExpiresAt = 0
  #bridgeId = ''
  #lastTouchSave = 0
  #saveChain: Promise<void> = Promise.resolve()
  #pruneTimer: NodeJS.Timeout | undefined

  constructor(options: PairingOptions) {
    this.#options = options
    this.#devicesPath = resolve(options.stateDir, 'devices.json')
    this.#statePath = resolve(options.stateDir, 'state.json')
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#devicesPath, 'utf8')) as Partial<DeviceFile>
      if (parsed.version === 1 && Array.isArray(parsed.devices)) {
        this.#devices = parsed.devices.filter((device): device is StoredDevice => (
          device !== null && typeof device === 'object'
          && typeof device.id === 'string'
          && typeof device.tokenHash === 'string'
          && typeof device.createdAt === 'number'
        ))
      }
    } catch {
      this.#devices = []
    }
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, 'utf8')) as { bridgeId?: unknown }
      if (typeof parsed.bridgeId === 'string' && parsed.bridgeId.length >= 16) this.#bridgeId = parsed.bridgeId
    } catch {
      /* create below */
    }
    if (this.#bridgeId === '') {
      this.#bridgeId = randomUUID()
      await writeJsonAtomic(this.#statePath, { version: 1, bridgeId: this.#bridgeId, createdAt: now() })
    }
    this.rotateCode()
    this.#pruneTimer = setInterval(() => this.prune(), 30_000)
    this.#pruneTimer.unref?.()
  }

  dispose(): void {
    if (this.#pruneTimer !== undefined) clearInterval(this.#pruneTimer)
    this.#pruneTimer = undefined
  }

  get fingerprint(): string {
    return 'dshm1-' + sha256Short(this.#bridgeId)
  }

  get code(): string {
    return this.#code
  }

  get codeExpiresAt(): number {
    return this.#codeExpiresAt
  }

  rotateCode(): string {
    this.#code = newPairCode()
    this.#codeExpiresAt = now() + this.#options.codeTtlSeconds * 1000
    return this.#code
  }

  payload(): PairingPayload {
    return {
      v: 1,
      u: this.#options.serverUrl(),
      c: formatPairCode(this.#code),
      n: this.#options.serverName,
      exp: this.#codeExpiresAt,
      f: this.fingerprint,
    }
  }

  info(code: string | undefined): PairInfoResponse {
    const valid = typeof code === 'string' && this.#codeValid(code)
    return {
      serverName: this.#options.serverName,
      version: this.#options.appVersion,
      platform: process.platform,
      protocol: 1,
      validCode: valid,
      expiresAt: this.#codeExpiresAt,
    }
  }

  #codeValid(input: string): boolean {
    return this.#code !== '' && this.#codeExpiresAt > now() && codeEquals(input, this.#code)
  }

  createRequest(body: PairRequestBody, ip: string): PairRequestReceipt {
    if (!this.#codeValid(body.code)) throw new BridgeError(403, 'pair-code-invalid', '配对码无效或已过期，请刷新电脑上的二维码')
    if (body.deviceId.trim() === '' || body.deviceId.length > 120) throw new BridgeError(400, 'device-invalid', 'deviceId is required')
    if (body.deviceName.trim() === '' || body.deviceName.length > 80) throw new BridgeError(400, 'device-name-invalid', 'deviceName is required')
    for (const pending of this.#pending.values()) {
      if (pending.deviceId === body.deviceId && pending.status === 'pending') this.#pending.delete(pending.id)
    }
    const createdAt = now()
    const request: PendingRequest = {
      id: randomUUID(),
      verificationCode: newVerificationCode(),
      deviceId: truncate(body.deviceId.trim(), 120),
      deviceName: truncate(body.deviceName.trim(), 80),
      platform: truncate(body.platform.trim() || 'unknown', 40),
      ...(body.appVersion !== undefined ? { appVersion: truncate(body.appVersion, 40) } : {}),
      ip,
      createdAt,
      expiresAt: createdAt + this.#options.requestTtlSeconds * 1000,
      status: 'pending',
    }
    this.#pending.set(request.id, request)
    if (this.#options.autoApprove) {
      const timer = setTimeout(() => {
        try {
          if (request.status === 'pending') this.approve(request.id)
        } catch {
          /* auto-approval is best-effort */
        }
      }, 600)
      timer.unref?.()
    }
    return {
      requestId: request.id,
      verificationCode: request.verificationCode,
      expiresAt: request.expiresAt,
      serverName: this.#options.serverName,
      serverUrl: this.#options.serverUrl(),
    }
  }

  status(id: string): PairStatusResponse {
    const request = this.#pending.get(id)
    if (request === undefined) throw new BridgeError(404, 'pair-request-not-found', '配对请求不存在或已失效')
    if (request.status === 'pending' && request.expiresAt <= now()) request.status = 'expired'
    if (request.status === 'approved' && request.token !== undefined && request.tokenDelivered !== true) {
      request.tokenDelivered = true
      const token = request.token
      request.token = undefined
      setTimeout(() => this.#pending.delete(id), 30_000).unref?.()
      return {
        status: 'approved',
        token,
        ...(request.device !== undefined ? { device: this.#publicDevice(request.device) } : {}),
        ...(request.device !== undefined ? { tokenExpiresAt: request.device.expiresAt } : {}),
      }
    }
    return {
      status: request.status,
      ...(request.status === 'approved' && request.device !== undefined ? { device: this.#publicDevice(request.device) } : {}),
      ...(request.status === 'denied' ? { reason: '电脑端拒绝了这次配对' } : {}),
      ...(request.status === 'expired' ? { reason: '配对请求已过期' } : {}),
    }
  }

  approve(id: string): { device: DeviceInfo; token: string } {
    const request = this.#pending.get(id)
    if (request === undefined) throw new BridgeError(404, 'pair-request-not-found', '配对请求不存在')
    if (request.status !== 'pending') throw new BridgeError(409, 'pair-request-settled', '配对请求已经处理过了')
    if (request.expiresAt <= now()) {
      request.status = 'expired'
      throw new BridgeError(410, 'pair-request-expired', '配对请求已过期，请让手机重新发起')
    }
    const token = TOKEN_PREFIX + randomToken(32)
    const createdAt = now()
    const device: StoredDevice = {
      id: randomUUID(),
      name: request.deviceName,
      platform: request.platform,
      tokenHash: hashToken(token),
      createdAt,
      lastSeenAt: createdAt,
      lastIp: request.ip,
      expiresAt: createdAt + DEVICE_LIFETIME_MS,
    }
    this.#devices.push(device)
    request.status = 'approved'
    request.token = token
    request.device = device
    this.#scheduleSave()
    return { device: this.#publicDevice(device), token }
  }

  deny(id: string): void {
    const request = this.#pending.get(id)
    if (request === undefined) throw new BridgeError(404, 'pair-request-not-found', '配对请求不存在')
    if (request.status !== 'pending') throw new BridgeError(409, 'pair-request-settled', '配对请求已经处理过了')
    request.status = 'denied'
    setTimeout(() => this.#pending.delete(id), 60_000).unref?.()
  }

  authenticate(token: string | undefined): DeviceInfo | undefined {
    if (token === undefined || !token.startsWith(TOKEN_PREFIX)) return undefined
    const tokenHash = hashToken(token)
    for (const device of this.#devices) {
      if (device.expiresAt <= now()) continue
      if (safeEqual(device.tokenHash, tokenHash)) {
        device.lastSeenAt = now()
        this.#maybeSaveTouch()
        return this.#publicDevice(device)
      }
    }
    return undefined
  }

  revoke(id: string): void {
    const before = this.#devices.length
    this.#devices = this.#devices.filter((device) => device.id !== id)
    if (this.#devices.length !== before) this.#scheduleSave()
    for (const [requestId, request] of this.#pending) {
      if (request.device?.id === id) this.#pending.delete(requestId)
    }
  }

  adminState(currentDeviceId?: string): AdminState {
    const pending: AdminPendingView[] = []
    for (const request of this.#pending.values()) {
      if (request.status === 'pending' && request.expiresAt <= now()) request.status = 'expired'
      if (request.status !== 'pending') continue
      pending.push({
        id: request.id,
        verificationCode: request.verificationCode,
        deviceName: request.deviceName,
        platform: request.platform,
        ...(request.appVersion !== undefined ? { appVersion: request.appVersion } : {}),
        ip: request.ip,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        status: request.status,
      })
    }
    pending.sort((a, b) => b.createdAt - a.createdAt)
    return {
      serverName: this.#options.serverName,
      serverUrl: this.#options.serverUrl(),
      pairCode: formatPairCode(this.#code),
      codeExpiresAt: this.#codeExpiresAt,
      codeTtlSeconds: this.#options.codeTtlSeconds,
      serverNow: now(),
      pending,
      devices: this.#devices
        .slice()
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map((device) => this.#publicDevice(device, currentDeviceId)),
      fingerprint: this.fingerprint,
    }
  }

  prune(): void {
    const at = now()
    for (const [id, request] of this.#pending) {
      if (request.expiresAt + 60_000 <= at || (request.status !== 'pending' && request.expiresAt + 300_000 <= at)) {
        this.#pending.delete(id)
      }
    }
  }

  #publicDevice(device: StoredDevice, currentDeviceId?: string): DeviceInfo {
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      ...(device.lastIp !== undefined ? { lastIp: device.lastIp } : {}),
      ...(currentDeviceId !== undefined && currentDeviceId === device.id ? { current: true } : {}),
    }
  }

  #maybeSaveTouch(): void {
    const at = now()
    if (at - this.#lastTouchSave < 60_000) return
    this.#lastTouchSave = at
    this.#scheduleSave()
  }

  #scheduleSave(): void {
    this.#saveChain = this.#saveChain.then(async () => {
      await writeJsonAtomic(this.#devicesPath, { version: 1, devices: this.#devices } satisfies DeviceFile)
    }).catch(() => {
      /* a failed device save must not crash the bridge */
    })
  }

  async flush(): Promise<void> {
    await this.#saveChain
  }
}
