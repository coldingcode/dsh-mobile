import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeHtml } from './util.ts'

export interface PairPageInput {
  serverName: string
  serverUrl: string
  fingerprint: string
  appVersion: string
}

let cached: string | undefined

function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(process.env.DSH_MOBILE_PAIR_PAGE ?? resolve(here, 'pair-page.html'))
}

function template(): string {
  if (cached !== undefined) return cached
  cached = readFileSync(templatePath(), 'utf8')
  return cached
}

/** Desktop-only pairing page. Served on loopback and gated by a per-run admin token. */
export function renderPairPage(input: PairPageInput): string {
  return template()
    .replaceAll('{{SERVER_NAME}}', escapeHtml(input.serverName))
    .replaceAll('{{SERVER_URL}}', escapeHtml(input.serverUrl))
    .replaceAll('{{FINGERPRINT}}', escapeHtml(input.fingerprint))
    .replaceAll('{{VERSION}}', escapeHtml(input.appVersion))
}
