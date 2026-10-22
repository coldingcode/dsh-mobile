import { createReadStream, existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

export const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' ws: wss:",
  "manifest-src 'self'",
].join('; ')

export const PAIR_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
].join('; ')

export function commonHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  }
}

export function resolveWebDist(explicit?: string): string {
  if (explicit !== undefined && explicit !== '') return explicit
  if (process.env.DSH_MOBILE_WEB_DIST !== undefined && process.env.DSH_MOBILE_WEB_DIST !== '') return process.env.DSH_MOBILE_WEB_DIST
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', 'web-dist'),
    resolve(here, '..', '..', 'web-dist'),
    resolve(process.cwd(), 'web-dist'),
  ]
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'index.html'))) return candidate
  }
  return candidates[0] as string
}

export function resolvePackageFile(relative: string): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', relative),
    resolve(here, '..', '..', relative),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      /* next */
    }
  }
  return undefined
}

export async function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string, cacheControl: string, contentType?: string): Promise<boolean> {
  let info
  try {
    info = await stat(filePath)
  } catch {
    return false
  }
  if (!info.isFile()) return false
  const type = contentType ?? MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': type,
    'content-length': String(info.size),
    'cache-control': cacheControl,
    'last-modified': info.mtime.toUTCString(),
  })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  await new Promise<void>((resolveDone, rejectDone) => {
    const stream = createReadStream(filePath)
    stream.on('error', rejectDone)
    stream.on('end', resolveDone)
    stream.pipe(res)
  }).catch(() => {
    if (!res.headersSent) res.destroy()
  })
  return true
}

/** Serve the built web app, with SPA fallback and a friendly build hint. */
export async function serveWebApp(req: IncomingMessage, res: ServerResponse, webDist: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...commonHeaders(), allow: 'GET, HEAD' })
    res.end()
    return
  }
  let relative = 'index.html'
  try {
    const url = new URL(req.url ?? '/', 'http://local')
    const pathname = decodeURIComponent(url.pathname)
    if (pathname !== '/') relative = pathname.replace(/^\/+/u, '')
  } catch {
    res.writeHead(400, commonHeaders())
    res.end('bad request')
    return
  }
  if (relative.includes('\0') || relative.split('/').includes('..')) {
    res.writeHead(400, commonHeaders())
    res.end('bad request')
    return
  }
  const root = resolve(webDist)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, commonHeaders())
    res.end('forbidden')
    return
  }
  const isIndex = relative === 'index.html'
  if (!isIndex) {
    const cache = relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    const served = await sendFile(req, res, target, cache)
    if (served) return
    if (extname(relative) !== '') {
      res.writeHead(404, { ...commonHeaders(), 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
  }
  const index = join(root, 'index.html')
  try {
    await stat(index)
  } catch {
    const hint = '<!doctype html><meta charset="utf-8"><title>dsh-mobile</title>' +
      '<body style="background:#07070c;color:#f7f7fb;font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:40px;line-height:1.7">' +
      '<h1 style="letter-spacing:-.04em">dsh-mobile</h1>' +
      '<p>移动端界面还没有构建。请在仓库中运行 <code>pnpm build:web</code>，或安装已构建的 npm 包。</p>' +
      '<p style="color:#9aa">Bridge is running, but web-dist/index.html is missing.</p></body>'
    res.writeHead(200, {
      ...commonHeaders(),
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': APP_CSP,
      'cache-control': 'no-store',
    })
    res.end(hint)
    return
  }
  res.setHeader('content-security-policy', APP_CSP)
  res.setHeader('cache-control', 'no-store')
  await sendFile(req, res, index, 'no-store', 'text/html; charset=utf-8')
}

/** Tiny JSON manifest fallback for an unbundled web directory. */
export function fallbackManifest(serverName: string): string {
  return JSON.stringify({
    name: serverName + ' · dsh-mobile',
    short_name: 'dsh-mobile',
    description: '本地 DeepSeek Harness 的手机端壳',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#07070c',
    theme_color: '#07070c',
    icons: [{ src: './icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' }],
    lang: 'zh-CN',
  }, null, 2)
}
