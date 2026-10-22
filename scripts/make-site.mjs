import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import QRCode from 'qrcode'

const root = resolve(import.meta.dirname, '..')
const siteDir = resolve(process.env.SITE_DIR ?? join(root, 'site'))
const version = process.env.VERSION ?? '0.1.0'
const bundleId = process.env.BUNDLE_ID ?? 'app.dsh.mobile'
const build = process.env.BUILD ?? '1'
const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? 'owner/dsh-mobile'
const [owner, name] = repo.split('/')
const tag = process.env.TAG ?? ('v' + version)
const configuredSiteUrl = process.env.SITE_URL !== undefined && process.env.SITE_URL.trim() !== '' ? process.env.SITE_URL : undefined
const siteUrl = (configuredSiteUrl ?? ('https://' + owner + '.github.io/' + name + '/')).replace(/\/?$/u, '/')
const releaseBase = 'https://github.com/' + repo + '/releases/download/' + tag + '/'
const unsignedName = 'dsh-mobile-unsigned.ipa'
const signedName = 'dsh-mobile-signed.ipa'
const unsignedUrl = releaseBase + unsignedName
const signedUrl = releaseBase + signedName
const iconSource = resolve(process.env.ICON_PATH ?? join(root, 'assets', 'icon.png'))
const ipaPath = process.env.IPA_PATH
const signedPath = process.env.SIGNED_IPA_PATH
const notes = process.env.NOTES ?? ''

const unsignedSize = ipaPath !== undefined && existsSync(ipaPath) ? (await stat(ipaPath)).size : 0
const signedSize = signedPath !== undefined && existsSync(signedPath) ? (await stat(signedPath)).size : 0
const sourceUrl = siteUrl + 'altstore.json'
const screenshotPath = join(root, 'Preview', 'screenshots', '01-home-dark.png')
const hasScreenshot = existsSync(screenshotPath)

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", '&apos;')
}

function plist(value) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' + value + '\n</plist>\n'
}

await mkdir(siteDir, { recursive: true })
await copyFile(iconSource, join(siteDir, 'icon.png'))
if (hasScreenshot) await copyFile(screenshotPath, join(siteDir, 'screenshot-home.png'))

const altstore = {
  name: 'dsh-mobile',
  subtitle: '把本机 DeepSeek Harness 带到手机上',
  description: 'dsh-mobile 是一个自托管的 iOS 壳：通过扫码把 iPhone 绑定到电脑上的 DSH 插件，在本机执行代码、读取文件和运行命令。不是 App Store 版本，使用 AltStore / SideStore 或你自己的证书安装。',
  iconURL: siteUrl + 'icon.png',
  headerURL: siteUrl + (hasScreenshot ? 'screenshot-home.png' : 'icon.png'),
  website: 'https://github.com/' + repo,
  tintColor: '#7C8CFF',
  featuredApps: [bundleId],
  apps: [
    {
      name: 'dsh-mobile',
      bundleIdentifier: bundleId,
      developerName: 'dsh-mobile',
      subtitle: '本机 DSH 的 iPhone 壳',
      localizedDescription: '扫码绑定本机 DeepSeek Harness。手机只发消息，代码、文件和命令都在你的电脑上执行。',
      iconURL: siteUrl + 'icon.png',
      tintColor: '#7C8CFF',
      category: 'developer',
      screenshots: hasScreenshot ? [siteUrl + 'screenshot-home.png'] : [],
      versions: [
        {
          version,
          date: new Date().toISOString(),
          localizedDescription: notes !== '' ? notes : '自托管构建。首次安装后在 iOS 设置中信任开发者证书。',
          downloadURL: unsignedUrl,
          size: unsignedSize,
          minOSVersion: '17.0',
        },
      ],
    },
  ],
  news: [],
}
await writeFile(join(siteDir, 'altstore.json'), JSON.stringify(altstore, null, 2) + '\n')

if (signedSize > 0) {
  const manifest = plist(
    '<dict>\n' +
    '  <key>items</key>\n' +
    '  <array>\n' +
    '    <dict>\n' +
    '      <key>assets</key>\n' +
    '      <array>\n' +
    '        <dict>\n' +
    '          <key>kind</key><string>software-package</string>\n' +
    '          <key>url</key><string>' + escapeXml(signedUrl) + '</string>\n' +
    '        </dict>\n' +
    '      </array>\n' +
    '      <key>metadata</key>\n' +
    '      <dict>\n' +
    '        <key>bundle-identifier</key><string>' + escapeXml(bundleId) + '</string>\n' +
    '        <key>bundle-version</key><string>' + escapeXml(version) + '</string>\n' +
    '        <key>kind</key><string>software</string>\n' +
    '        <key>title</key><string>dsh-mobile</string>\n' +
    '      </dict>\n' +
    '    </dict>\n' +
    '  </array>\n' +
    '</dict>'
  )
  await writeFile(join(siteDir, 'manifest.plist'), manifest)
}

const qrSvg = await QRCode.toString(siteUrl, {
  type: 'svg',
  margin: 1,
  width: 420,
  errorCorrectionLevel: 'M',
  color: { dark: '#101018', light: '#ffffff' },
})

const otaButton = signedSize > 0
  ? '<a class="primary" href="itms-services://?action=download-manifest&amp;url=' + encodeURIComponent(siteUrl + 'manifest.plist') + '">直接安装已签名 IPA</a>'
  : '<div class="notice">这次构建没有签名 IPA。请用 AltStore / SideStore 重签，或使用你自己的证书重新运行工作流。</div>'

const html = '<!doctype html>\n' +
'<html lang="zh-CN">\n<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
'<meta name="color-scheme" content="dark light">\n' +
'<title>dsh-mobile · 安装</title>\n' +
'<style>\n' +
':root{--bg:#07070c;--ink:#f7f7fb;--muted:rgba(235,236,255,.58);--line:rgba(255,255,255,.13);--accent:#7c8cff;--accent2:#56d7ff;--green:#5ee6a8;--red:#ff6b81;--radius:30px;--shadow:0 30px 90px rgba(0,0,0,.55)}\n' +
'*{box-sizing:border-box}html,body{min-height:100%}body{margin:0;color:var(--ink);background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}\n' +
'body::before,body::after{content:"";position:fixed;width:54vw;height:54vw;border-radius:50%;filter:blur(100px);opacity:.42;pointer-events:none;z-index:0}\n' +
'body::before{left:-20vw;top:-20vw;background:radial-gradient(circle,#5b6cff,transparent 66%)}body::after{right:-22vw;bottom:-26vw;background:radial-gradient(circle,#26c9d8,transparent 68%)}\n' +
'.wrap{position:relative;z-index:1;width:min(1120px,calc(100% - 40px));margin:0 auto;padding:42px 0 54px}\n' +
'.top{display:flex;align-items:center;gap:14px;margin-bottom:34px}.mark{width:52px;height:52px;border-radius:16px;background:radial-gradient(120% 120% at 20% 10%,rgba(255,255,255,.95),rgba(255,255,255,.4) 18%,transparent 44%),linear-gradient(145deg,#7a8cff,#4b5ce6 42%,#1f2448);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 16px 40px rgba(68,88,255,.38);display:grid;place-items:center;font-weight:800;font-size:22px;letter-spacing:-.06em}\n' +
'.brand strong{display:block;font-size:20px;letter-spacing:-.03em}.brand span{display:block;color:var(--muted);font-size:12px;margin-top:2px}.pill{margin-left:auto;padding:9px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.06);font-size:11.5px;color:var(--muted);display:flex;gap:8px;align-items:center}.dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green)}\n' +
'.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:26px}.glass{position:relative;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(145deg,rgba(255,255,255,.12),rgba(255,255,255,.035));box-shadow:var(--shadow),inset 0 1px 0 rgba(255,255,255,.18);backdrop-filter:blur(34px) saturate(170%);overflow:hidden}.glass::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(120deg,rgba(255,255,255,.17),transparent 26%,transparent 72%,rgba(255,255,255,.06));mix-blend-mode:screen}\n' +
'.hero-card{padding:32px;display:flex;gap:30px;align-items:center}.qr{flex:0 0 260px;width:260px;height:260px;padding:15px;border-radius:30px;background:#fff;box-shadow:0 26px 70px rgba(0,0,0,.5)}.qr svg{width:100%;height:100%;display:block;border-radius:18px}.copy{flex:1;min-width:0;position:relative;z-index:1}.kicker{color:var(--accent2);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}h1{margin:10px 0;font-size:clamp(30px,3.4vw,46px);line-height:1.04;letter-spacing:-.045em}.lede{margin:0 0 20px;color:var(--muted);font-size:13.5px;line-height:1.75}.lede strong{color:var(--ink)}.meta{display:flex;flex-wrap:wrap;gap:6px}.chip{display:inline-flex;align-items:center;gap:5px;height:27px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--muted);font-size:10.5px;font-family:"SF Mono",ui-monospace,monospace}\n' +
'.side{display:flex;flex-direction:column;gap:16px}.card{padding:22px}.card h2{margin:0 0 4px;font-size:15px;letter-spacing:-.02em}.card p{margin:0 0 14px;color:var(--muted);font-size:12px;line-height:1.65}.primary,.secondary,.ghost{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 15px;border-radius:13px;font-size:12.5px;font-weight:600;text-decoration:none;cursor:pointer;border:0;font-family:inherit}\n' +
'.primary{width:100%;color:#fff;background:linear-gradient(145deg,#7d8dff,#4e5fe0);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 10px 26px rgba(72,86,220,.32)}.secondary{width:100%;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--line)}.ghost{color:var(--muted);background:rgba(255,255,255,.04);border:1px solid var(--line);font-size:11px;min-height:36px;padding:0 11px}.row{display:flex;gap:7px;margin-top:8px}.row .secondary{flex:1}.notice{padding:11px 12px;border-radius:12px;background:rgba(255,214,121,.08);border:1px solid rgba(255,214,121,.2);color:#ffd479;font-size:11px;line-height:1.55}\n' +
'.source{margin:10px 0 12px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.28);border:1px solid var(--line);font-family:"SF Mono",ui-monospace,monospace;font-size:10.5px;color:var(--muted);word-break:break-all}\n' +
'.steps{margin-top:26px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.step{padding:16px;border-radius:18px;border:1px solid var(--line);background:rgba(255,255,255,.04)}.step b{display:block;font-size:12.5px;margin-bottom:5px}.step span{display:block;color:var(--muted);font-size:11px;line-height:1.55}.num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:rgba(124,140,255,.14);color:#c6ceff;font-size:11px;font-family:"SF Mono",ui-monospace,monospace;margin-bottom:9px}\n' +
'.foot{margin-top:28px;display:flex;flex-wrap:wrap;gap:10px 22px;color:rgba(235,236,255,.4);font-size:11px}.foot .mono{font-family:"SF Mono",ui-monospace,monospace}.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);opacity:0;pointer-events:none;padding:10px 16px;border-radius:999px;background:rgba(18,18,28,.9);border:1px solid var(--line);font-size:12px;transition:.25s;z-index:10}.toast.show{opacity:1;transform:translate(-50%,0)}\n' +
'@media(max-width:900px){.hero{grid-template-columns:1fr}.hero-card{flex-direction:column;align-items:flex-start}.qr{width:min(260px,100%);height:auto;aspect-ratio:1;flex:none}.steps{grid-template-columns:1fr}.top .pill{display:none}}\n' +
'@media(max-width:560px){.wrap{width:min(100% - 28px,1120px);padding-top:26px}.hero-card{padding:22px}.card{padding:18px}.glass{border-radius:26px}}\n' +
'@media(prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}\n' +
'</style>\n</head>\n<body>\n<div class="wrap">\n' +
'<header class="top"><div class="mark">d</div><div class="brand"><strong>dsh-mobile</strong><span>本机 DeepSeek Harness · 自托管安装</span></div><div class="pill"><span class="dot"></span>v' + escapeHtml(version) + ' · build ' + escapeHtml(build) + '</div></header>\n' +
'<main class="hero">\n<section class="glass hero-card"><div class="qr">' + qrSvg + '</div><div class="copy"><div class="kicker">Self-hosted install</div><h1>把本机 DSH<br>放到手机上。</h1><p class="lede">这不是 App Store 版本。安装包由 GitHub Actions 构建，使用 <strong>AltStore / SideStore</strong> 或你自己的 Apple 证书自签安装。手机通过扫码绑定电脑上的 DSH 插件。</p><div class="meta"><span class="chip">iOS 17+</span><span class="chip">Liquid Glass</span><span class="chip">LAN pairing</span><span class="chip">' + escapeHtml(tag) + '</span></div></div></section>\n' +
'<aside class="side">\n<section class="glass card"><h2>1 · 添加 AltStore 源</h2><p>AltStore / SideStore 会用你的 Apple ID 重签并安装。不需要 App Store，也不需要开发者账号。</p><div class="source">' + escapeHtml(sourceUrl) + '</div><div class="row"><button class="primary" data-copy="' + escapeHtml(sourceUrl) + '">复制源地址</button></div><div class="row"><a class="secondary" href="altstore://source?url=' + encodeURIComponent(sourceUrl) + '">打开 AltStore</a><a class="secondary" href="sidestore://source?url=' + encodeURIComponent(sourceUrl) + '">打开 SideStore</a></div></section>\n' +
'<section class="glass card"><h2>2 · 安装 dsh-mobile</h2><p>添加源后，在 AltStore 的 Sources 里找到 dsh-mobile 并安装。首次启动前需要在系统设置里信任证书。</p>' + otaButton + '<div class="row"><a class="secondary" href="' + unsignedUrl + '">下载未签名 IPA</a></div></section>\n' +
'<section class="glass card"><h2>3 · 信任并配对</h2><p>设置 → 通用 → VPN 与设备管理 → 信任开发者。然后打开 App，扫描电脑配对页上的二维码。</p><div class="notice">只在你自己的 Wi-Fi 或可信网络上配对。桥接默认以 workspace-write 权限运行；完整访问模式会明确提示。</div></section>\n' +
'</aside></main>\n' +
'<section class="steps"><div class="step"><span class="num">01</span><b>装插件</b><span>在电脑的 DSH 中安装 dsh-mobile 插件并重启，配对页会自动打开。</span></div><div class="step"><span class="num">02</span><b>扫码绑定</b><span>手机与电脑同一局域网。扫码后核对 6 位数字，允许设备。</span></div><div class="step"><span class="num">03</span><b>开始对话</b><span>会话、工具调用和文件都留在电脑上；手机只是遥控器。</span></div></section>\n' +
'<footer class="foot"><div>构建：GitHub Actions · ' + escapeHtml(repo) + ' · ' + escapeHtml(tag) + '</div><div>未签名 IPA：' + (unsignedSize > 0 ? (unsignedSize / 1024 / 1024).toFixed(1) + ' MB' : 'artifact') + '</div><div class="mono">' + (signedSize > 0 ? 'signed + unsigned' : 'unsigned only') + '</div><div>MIT · self-hosted</div></footer>\n' +
'</div><div class="toast" id="toast"></div><script>\n' +
'(()=>{const t=document.getElementById("toast");let timer;const show=(m)=>{t.textContent=m;t.classList.add("show");clearTimeout(timer);timer=setTimeout(()=>t.classList.remove("show"),2200)};document.addEventListener("click",async(e)=>{const b=e.target.closest("[data-copy]");if(!b)return;try{await navigator.clipboard.writeText(b.getAttribute("data-copy"));show("已复制")}catch{show("复制失败，请手动选择")}})})();\n' +
'</script></body></html>\n'
await writeFile(join(siteDir, 'index.html'), html)
console.log('site written to ' + siteDir)
console.log('install page: ' + siteUrl)
console.log('altstore source: ' + sourceUrl)
