import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PairingService } from '../src/plugin/pairing.ts'

let dir = ''
let pairing: PairingService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dshm-pairing-'))
  pairing = new PairingService({
    serverName: 'Test Studio',
    stateDir: dir,
    codeTtlSeconds: 600,
    requestTtlSeconds: 180,
    autoApprove: false,
    appVersion: '0.1.0',
    serverUrl: () => 'http://192.168.1.20:47821',
  })
  await pairing.load()
})

afterEach(async () => {
  pairing.dispose()
  await pairing.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('PairingService', () => {
  it('issues a one-time device token after approval', () => {
    expect(pairing.info(pairing.code).validCode).toBe(true)
    const receipt = pairing.createRequest({
      code: pairing.code,
      deviceId: 'device-1',
      deviceName: 'iPhone',
      platform: 'iOS',
      appVersion: '0.1.0',
    }, '192.168.1.50')
    expect(receipt.verificationCode).toMatch(/^[0-9]{6}$/)
    expect(pairing.adminState().pending).toHaveLength(1)
    const approved = pairing.approve(receipt.requestId)
    expect(approved.token.startsWith('dshm_')).toBe(true)
    const status = pairing.status(receipt.requestId)
    expect(status.status).toBe('approved')
    expect(status.token).toBe(approved.token)
    expect(pairing.status(receipt.requestId).token).toBeUndefined()
    expect(pairing.authenticate(approved.token)?.name).toBe('iPhone')
    expect(pairing.authenticate('dshm_wrong')).toBeUndefined()
    pairing.revoke(approved.device.id)
    expect(pairing.authenticate(approved.token)).toBeUndefined()
  })

  it('rejects an expired or wrong code', () => {
    expect(() => pairing.createRequest({
      code: 'AAAA-AAAA',
      deviceId: 'device-2',
      deviceName: 'iPhone',
      platform: 'iOS',
    }, '127.0.0.1')).toThrow()
  })

  it('rotates the code and invalidates the previous one', () => {
    const previous = pairing.code
    const next = pairing.rotateCode()
    expect(next).not.toBe(previous)
    expect(pairing.info(previous).validCode).toBe(false)
    expect(pairing.info(next).validCode).toBe(true)
  })
})
