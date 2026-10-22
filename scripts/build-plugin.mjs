import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'lib'), { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/plugin/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: resolve(root, 'lib/index.js'),
  external: ['canvas'],
  banner: {
    js: "import { createRequire as __dshMobileCreateRequire } from 'node:module'; const require = __dshMobileCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'info',
})

await copyFile(resolve(root, 'src/plugin/pair-page.html'), resolve(root, 'lib/pair-page.html'))

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const banner = '/*! dsh-mobile v' + pkg.version + ' — MIT licensed. Built by scripts/build-plugin.mjs. */\n'
const out = await readFile(resolve(root, 'lib/index.js'), 'utf8')
if (!out.startsWith('/*!')) await writeFile(resolve(root, 'lib/index.js'), banner + out)
