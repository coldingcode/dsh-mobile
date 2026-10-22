export interface NativeConfig {
  token: string
  serverUrl?: string
  serverName?: string
  appVersion?: string
  deviceName?: string
  platform?: string
}

export interface NativeMessage {
  type: 'haptic' | 'share' | 'openURL' | 'disconnect' | 'setTitle' | 'ready' | 'openSettings'
  [key: string]: unknown
}

declare global {
  interface Window {
    __DSH_MOBILE__?: NativeConfig
    dshMobileNative?: { postMessage: (message: NativeMessage) => void }
    webkit?: {
      messageHandlers?: {
        dshMobile?: { postMessage: (message: NativeMessage) => void }
      }
    }
  }
}

export const nativeConfig: NativeConfig | undefined = window.__DSH_MOBILE__
export const isNative = nativeConfig !== undefined

function post(message: NativeMessage): void {
  try {
    window.dshMobileNative?.postMessage(message)
    window.webkit?.messageHandlers?.dshMobile?.postMessage(message)
  } catch {
    /* native bridge is best-effort */
  }
}

export function haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light'): void {
  if (isNative) post({ type: 'haptic', style })
}

export async function share(payload: { title?: string; text?: string; url?: string }): Promise<void> {
  if (isNative) {
    post({ type: 'share', ...payload })
    return
  }
  if (navigator.share !== undefined) {
    try {
      await navigator.share(payload)
    } catch {
      /* user cancelled */
    }
  }
}

export function openURL(url: string): void {
  if (isNative) {
    post({ type: 'openURL', url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function disconnectNative(): void {
  if (isNative) post({ type: 'disconnect' })
}

export function openNativeSettings(): void {
  if (isNative) post({ type: 'openSettings' })
}

export function setNativeTitle(title: string): void {
  if (isNative) post({ type: 'setTitle', title })
  if (typeof document !== 'undefined') document.title = title
}

export function platformLabel(): string {
  if (nativeConfig?.platform !== undefined && nativeConfig.platform !== '') return nativeConfig.platform
  const ua = navigator.userAgent
  if (/iPhone/iu.test(ua)) return 'iPhone'
  if (/iPad/iu.test(ua)) return 'iPad'
  if (/Android/iu.test(ua)) return 'Android'
  return 'Web'
}

export function defaultDeviceName(): string {
  if (nativeConfig?.deviceName !== undefined && nativeConfig.deviceName !== '') return nativeConfig.deviceName
  const platform = platformLabel()
  return platform === 'Web' ? '浏览器' : platform
}

export function notifyReady(): void {
  if (isNative) post({ type: 'ready' })
}
