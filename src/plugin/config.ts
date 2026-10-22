import { homedir, hostname, networkInterfaces } from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { PermissionMode } from '../shared/protocol.ts'
import { APP_VERSION } from '../shared/protocol.ts'

export type TunnelMode = 'off' | 'quick'

export interface BridgeOptions {
  port: number
  bindHost: string
  publicUrl?: string
  tunnelMode: TunnelMode
  cloudflaredBinary: string
  workspace: string
  provider: string
  model: string
  permissionMode: PermissionMode
  serverName: string
  stateDir: string
  webDist?: string
  openPairingPage: boolean
  printTerminalQr: boolean
  autoApprove: boolean
  allowBrowserPairing: boolean
  pairingCodeTtlSeconds: number
  pairRequestTtlSeconds: number
  maxPairAttempts: number
  pairAttemptWindowSeconds: number
  maxBodyBytes: number
  sdkCommand?: string
  sdkArgs?: string[]
}

const DEFAULTS = {
  port: 47821,
  bindHost: '0.0.0.0',
  permissionMode: 'workspace-write' as PermissionMode,
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  pairingCodeTtlSeconds: 600,
  pairRequestTtlSeconds: 180,
  maxPairAttempts: 8,
  pairAttemptWindowSeconds: 600,
  maxBodyBytes: 24 * 1024 * 1024,
  tunnelMode: 'off' as TunnelMode,
  cloudflaredBinary: 'cloudflared',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true
    if (value === '0' || value.toLowerCase() === 'false') return false
  }
  return fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback
}

function normalizeBaseUrl(input: string | undefined): string | undefined {
  if (input === undefined || input.trim() === '') return undefined
  const raw = input.trim().replace(/\/+$/u, '')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('publicUrl must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('publicUrl must use http or https')
  return parsed.href.replace(/\/+$/u, '')
}

function ensureWorkspace(input: string): string {
  const resolved = isAbsolute(input) ? input : resolve(input)
  try {
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved
  } catch {
    /* fall through */
  }
  return homedir()
}

function defaultServerName(): string {
  const raw = hostname().replace(/\.local$/iu, '')
  return raw === '' ? 'My DSH' : raw
}

function tunnelMode(value: unknown, envValue: string | undefined): TunnelMode {
  const candidate = value ?? envValue
  if (candidate === undefined || candidate === null || candidate === false) return 'off'
  if (typeof candidate === 'string') {
    const normalized = candidate.trim().toLowerCase()
    if (normalized === '' || normalized === 'off' || normalized === 'none' || normalized === 'false' || normalized === '0') return 'off'
    if (normalized === 'quick' || normalized === 'cloudflared' || normalized === 'true' || normalized === '1') return 'quick'
    throw new Error('tunnel must be "off" or "quick"')
  }
  if (candidate === true) return 'quick'
  if (typeof candidate === 'object') {
    const record = asRecord(candidate)
    if (record.enabled === false) return 'off'
    if (record.enabled === true && record.mode === undefined) return 'quick'
    return tunnelMode(record.mode, undefined)
  }
  throw new Error('tunnel must be "off" or "quick"')
}

function cloudflaredBinary(value: unknown, envValue: string | undefined): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  const tunnel = asRecord(value)
  if (typeof tunnel.binary === 'string' && tunnel.binary.trim() !== '') return tunnel.binary.trim()
  if (envValue !== undefined && envValue.trim() !== '') return envValue.trim()
  return DEFAULTS.cloudflaredBinary
}

function privateV4Score(address: string): number {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 9
  const [a = 0, b = 0] = parts
  if (a === 192 && b === 168) return 0
  if (a === 10) return 1
  if (a === 172 && b >= 16 && b <= 31) return 2
  if (a === 169 && b === 254) return 6
  if (a === 127) return 7
  return 5
}

/** Prefer a private IPv4 LAN address; fall back to any non-internal IPv4/6 or loopback. */
export function pickLanAddress(): string {
  const interfaces = networkInterfaces()
  const candidates: Array<{ address: string; score: number }> = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family === 'IPv4') candidates.push({ address: entry.address, score: privateV4Score(entry.address) })
      else if (entry.family === 'IPv6') candidates.push({ address: entry.address, score: 3 })
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]?.address ?? '127.0.0.1'
}

/** Resolve plugin config plus environment overrides. */
export function resolveBridgeOptions(raw: unknown, env: NodeJS.ProcessEnv = process.env): BridgeOptions {
  const config = asRecord(raw)
  const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : resolve(homedir(), '.dsh')
  const envStateDir = env.DSH_MOBILE_STATE_DIR !== undefined && env.DSH_MOBILE_STATE_DIR.trim() !== '' ? env.DSH_MOBILE_STATE_DIR : undefined
  const stateDir = resolve(str(config.stateDir, envStateDir ?? resolve(home, 'dsh-mobile')))
  const webDist = str(config.webDist, env.DSH_MOBILE_WEB_DIST ?? '') || undefined
  const tunnelConfig = asRecord(config.tunnel)
  const mode = tunnelMode(config.tunnel, env.DSH_MOBILE_TUNNEL)
  const cloudflared = cloudflaredBinary(config.cloudflaredBinary ?? tunnelConfig.binary, env.DSH_MOBILE_CLOUDFLARED)
  const permissionMode = str(
    config.permissionMode,
    env.DSH_MOBILE_PERMISSION_MODE ?? DEFAULTS.permissionMode,
  ) as PermissionMode
  if (permissionMode !== 'workspace-write' && permissionMode !== 'danger-full-access') {
    throw new Error('permissionMode must be "workspace-write" or "danger-full-access"')
  }
  const configuredPort = int(config.port, int(env.DSH_MOBILE_PORT, DEFAULTS.port, 0, 65535), 0, 65535)
  const workspace = ensureWorkspace(str(config.workspace, env.DSH_MOBILE_WORKSPACE ?? process.cwd()))
  const sdkCommand = str(config.sdkCommand, env.DSH_MOBILE_SDK_COMMAND ?? '') || undefined
  let sdkArgs: string[] | undefined
  if (Array.isArray(config.sdkArgs) && config.sdkArgs.every((entry) => typeof entry === 'string')) {
    sdkArgs = config.sdkArgs as string[]
  } else if (typeof env.DSH_MOBILE_SDK_ARGS === 'string' && env.DSH_MOBILE_SDK_ARGS.trim() !== '') {
    sdkArgs = env.DSH_MOBILE_SDK_ARGS.split(' ').filter(Boolean)
  }
  return {
    port: configuredPort,
    bindHost: str(config.bindHost, env.DSH_MOBILE_BIND ?? DEFAULTS.bindHost),
    ...(normalizeBaseUrl(str(config.publicUrl, env.DSH_MOBILE_PUBLIC_URL ?? '')) !== undefined
      ? { publicUrl: normalizeBaseUrl(str(config.publicUrl, env.DSH_MOBILE_PUBLIC_URL ?? '')) }
      : {}),
    tunnelMode: mode,
    cloudflaredBinary: cloudflared,
    workspace,
    provider: str(config.provider, env.DSH_MOBILE_PROVIDER ?? DEFAULTS.provider),
    model: str(config.model, env.DSH_MOBILE_MODEL ?? DEFAULTS.model),
    permissionMode,
    serverName: str(config.serverName, env.DSH_MOBILE_SERVER_NAME ?? defaultServerName()),
    stateDir,
    ...(webDist !== undefined ? { webDist: resolve(webDist) } : {}),
    openPairingPage: bool(config.openPairingPage, bool(env.DSH_MOBILE_OPEN_PAIRING_PAGE, true)),
    printTerminalQr: bool(config.printTerminalQr, bool(env.DSH_MOBILE_PRINT_QR, true)),
    autoApprove: bool(config.autoApprove, bool(env.DSH_MOBILE_AUTO_APPROVE, false)),
    allowBrowserPairing: bool(config.allowBrowserPairing, bool(env.DSH_MOBILE_ALLOW_BROWSER_PAIRING, true)),
    pairingCodeTtlSeconds: int(config.pairingCodeTtlSeconds, int(env.DSH_MOBILE_CODE_TTL, DEFAULTS.pairingCodeTtlSeconds, 60, 3600), 60, 3600),
    pairRequestTtlSeconds: int(config.pairRequestTtlSeconds, DEFAULTS.pairRequestTtlSeconds, 60, 900),
    maxPairAttempts: int(config.maxPairAttempts, DEFAULTS.maxPairAttempts, 1, 100),
    pairAttemptWindowSeconds: int(config.pairAttemptWindowSeconds, DEFAULTS.pairAttemptWindowSeconds, 60, 3600),
    maxBodyBytes: int(config.maxBodyBytes, DEFAULTS.maxBodyBytes, 1024, 64 * 1024 * 1024),
    ...(sdkCommand !== undefined ? { sdkCommand } : {}),
    ...(sdkArgs !== undefined ? { sdkArgs } : {}),
  }
}

export const APP_INFO = { name: 'dsh-mobile', version: APP_VERSION }
