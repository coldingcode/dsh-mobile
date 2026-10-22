import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.SHOT_PORT ?? 47899)
const base = 'http://127.0.0.1:' + String(port)
const outDir = resolve(root, 'Preview', 'screenshots')
const stateDir = resolve(root, '.tmp', 'shot-state')
const infoPath = resolve(root, '.tmp', 'dev-info.json')

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) return candidate
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH to run screenshots.')
}

async function waitForInfo(): Promise<{ port: number; adminToken: string; pairCode: string }> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(infoPath, 'utf8')) as { port: number; adminToken: string; pairCode: string }
      if (parsed.port === port) return parsed
    } catch {
      /* not ready */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error('dev server did not become ready')
}

async function pair(): Promise<string> {
  const info = await waitForInfo()
  const receipt = await fetch(base + '/api/pair/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: info.pairCode, deviceId: 'screenshot-device', deviceName: 'iPhone 16 Pro', platform: 'iOS', appVersion: '0.1.0' }),
  }).then((response) => response.json()) as { requestId: string }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const status = await fetch(base + '/api/pair/request/' + encodeURIComponent(receipt.requestId)).then((response) => response.json()) as { status: string; token?: string }
    if (status.status === 'approved' && status.token !== undefined) return status.token
    if (status.status === 'denied' || status.status === 'expired') throw new Error('pairing failed: ' + status.status)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350))
  }
  throw new Error('pairing timed out')
}

async function contextFor(browser: Browser, token: string, options: { light?: boolean } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: options.light === true ? 'light' : 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    locale: 'zh-CN',
  })
  await context.addCookies([{ name: 'dshm_session', value: token, domain: '127.0.0.1', path: '/' }])
  if (options.light === true) {
    await context.addInitScript(() => {
      try { localStorage.setItem('dshm-theme', 'light') } catch (error) { void error }
    })
  }
  return context
}

async function shot(page: import('playwright-core').Page, name: string, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: 15_000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: resolve(outDir, name) })
  console.log('captured', name)
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(infoPath, { force: true })
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', resolve(root, 'src/dev/dev-server.ts')], {
    cwd: root,
    env: {
      ...process.env,
      DSH_MOBILE_PORT: String(port),
      DSH_MOBILE_STATE_DIR: stateDir,
      DSH_MOBILE_WEB_DIST: resolve(root, 'web-dist'),
      DSH_MOBILE_SERVER_NAME: 'Studio',
      DSH_MOBILE_OPEN_PAIRING_PAGE: 'false',
      DSH_MOBILE_DEMO: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write('[bridge] ' + chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write('[bridge] ' + chunk.toString()))
  try {
    const token = await pair()
    const browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
    })
    try {
      const dark = await contextFor(browser, token)
      const page = await dark.newPage()
      await page.goto(base + '/#/', { waitUntil: 'domcontentloaded' })
      await shot(page, '01-home-dark.png', '.home-screen')
      await page.goto(base + '/#/session/demo-build-fix', { waitUntil: 'domcontentloaded' })
      await shot(page, '02-chat-dark.png', '.msg-assistant')
      await page.goto(base + '/#/activity', { waitUntil: 'domcontentloaded' })
      await shot(page, '03-activity-dark.png', '.activity-row')
      await page.goto(base + '/#/settings', { waitUntil: 'domcontentloaded' })
      await shot(page, '04-settings-dark.png', '.settings-card')
      await dark.close()

      const light = await contextFor(browser, token, { light: true })
      const lightPage = await light.newPage()
      await lightPage.goto(base + '/#/', { waitUntil: 'domcontentloaded' })
      await shot(lightPage, '05-home-light.png', '.home-screen')
      await lightPage.goto(base + '/#/session/demo-design', { waitUntil: 'domcontentloaded' })
      await shot(lightPage, '06-chat-light.png', '.msg-assistant')
      await light.close()

      const pairing = await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
        locale: 'zh-CN',
      })
      const pairingPage = await pairing.newPage()
      await pairingPage.goto(base + '/#/', { waitUntil: 'domcontentloaded' })
      await shot(pairingPage, '07-web-pairing.png', '.pair-card')
      await pairing.close()

      const desktop = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'zh-CN' })
      const desktopPage = await desktop.newPage()
      const info = await waitForInfo()
      await desktopPage.goto(base + '/pair?admin=' + encodeURIComponent(info.adminToken), { waitUntil: 'domcontentloaded' })
      await shot(desktopPage, '08-desktop-pairing.png', '#qr')
      await desktop.close()
    } finally {
      await browser.close()
    }
    console.log('screenshots written to', outDir)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
