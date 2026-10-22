import { describe, expect, it } from 'vitest'
import {
  decodePairingPayload,
  encodePairingPayload,
  formatPairCode,
  isPairCode,
  makePairingUri,
  normalizePairCode,
  parsePairingUri,
} from '../src/shared/protocol.ts'

const payload = {
  v: 1 as const,
  u: 'http://192.168.1.20:47821',
  c: '7KQ2-9W6M',
  n: 'Studio 的 MacBook',
  exp: 1_792_660_000_000,
  f: 'dshm1-abc123',
}

describe('pairing payload', () => {
  it('round-trips through base64url', () => {
    expect(decodePairingPayload(encodePairingPayload(payload))).toEqual(payload)
  })

  it('builds and parses the QR URI', () => {
    const uri = makePairingUri(payload)
    expect(uri.startsWith('dshm://pair?d=')).toBe(true)
    expect(parsePairingUri(uri)).toEqual(payload)
  })

  it('accepts a raw encoded payload', () => {
    expect(parsePairingUri(encodePairingPayload(payload))).toEqual(payload)
  })

  it('rejects malformed payloads', () => {
    expect(() => parsePairingUri('dshm://pair?d=not-base64')).toThrow()
    expect(() => decodePairingPayload(encodePairingPayload({ ...payload, u: 'ftp://host' } as never))).toThrow()
  })
})

describe('pairing codes', () => {
  it('formats and normalizes ambiguous characters', () => {
    expect(formatPairCode('7kq29w6m')).toBe('7KQ2-9W6M')
    expect(normalizePairCode('7kq2-9w6m')).toBe('7KQ29W6M')
    expect(isPairCode('7KQ2-9W6M')).toBe(true)
    expect(isPairCode('XXXX')).toBe(false)
  })
})
