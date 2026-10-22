import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function bridgePort(): number {
  const infoPath = resolve(import.meta.dirname, '.tmp', 'dev-info.json')
  if (existsSync(infoPath)) {
    try {
      const parsed = JSON.parse(readFileSync(infoPath, 'utf8')) as { port?: unknown }
      if (typeof parsed.port === 'number' && parsed.port > 0) return parsed.port
    } catch {
      /* fall through to the environment */
    }
  }
  const value = Number(process.env.DSH_MOBILE_PORT ?? 47821)
  return Number.isFinite(value) && value > 0 ? value : 47821
}

const bridgeBase = 'http://127.0.0.1:' + String(bridgePort())

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  base: './',
  publicDir: resolve(import.meta.dirname, 'src/web/public'),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'web-dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'safari17',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': bridgeBase,
      '/ws': { target: bridgeBase.replace('http', 'ws'), ws: true },
      '/icon.png': bridgeBase,
    },
  },
})
