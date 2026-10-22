import { MobileBridge } from './bridge.ts'
import { resolveBridgeOptions } from './config.ts'

export const name = 'dsh-mobile'

interface PluginContext {
  effect: (execute: () => Promise<() => Promise<void>> | (() => Promise<void>)) => unknown
}

/**
 * DSH plugin entry. Loading this row starts the LAN bridge; disposing the
 * plugin closes the listener, the runtime child and the durable journal.
 */
export function apply(ctx: PluginContext, rawConfig: unknown): void {
  let options
  try {
    options = resolveBridgeOptions(rawConfig)
  } catch (error) {
    console.error('[dsh-mobile] invalid configuration:', error instanceof Error ? error.message : error)
    throw error
  }
  const bridge = new MobileBridge(options)
  ctx.effect(async () => {
    const info = await bridge.start()
    console.log('[dsh-mobile] pairing page: ' + info.pairingUrl)
    console.log('[dsh-mobile] phone URL: ' + info.serverUrl)
    return async () => {
      await bridge.stop()
    }
  })
}
