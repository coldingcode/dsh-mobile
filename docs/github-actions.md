# GitHub Actions、签名 Secrets 与 Pages

仓库包含两条流水线：

| 文件 | 作用 | 触发 |
| --- | --- | --- |
| .github/workflows/ci.yml | 插件/Web 类型检查、测试、构建、上传产物 | push main、PR、手动 |
| .github/workflows/ios.yml | 模拟器构建、截图、未签名 IPA、可选签名 IPA、AltStore 源、安装页、Release、Pages | push main/tag、PR、手动 |

## CI

步骤：

1. 安装 pnpm 和 Node 22；
2. <code>pnpm install --frozen-lockfile</code>；
3. <code>tsc --noEmit</code>；
4. <code>vitest run</code>（协议、Journal、Pairing、Bridge、Tunnel 解析）；
5. <code>pnpm build</code>（esbuild 插件 + Vite Web）；
6. 校验 <code>lib/index.js</code>、<code>lib/pair-page.html</code>、<code>web-dist/index.html</code> 存在；
7. 上传构建产物。

测试不调用真实模型，全部使用 mock runtime。

## iOS 构建

<code>ios.yml</code> 在 <code>macos-15</code> 上：

1. 安装 XcodeGen，生成 <code>ios/dsh-mobile.xcodeproj</code>（工程文件不入库）；
2. 构建 iOS Simulator 的 Debug 包；
3. 启动 iPhone 模拟器，安装并截图 <code>ios-onboarding.png</code>；
4. 构建 **未签名** device Release，打包成 <code>dsh-mobile-unsigned.ipa</code>；
5. 如果配置了签名 secrets，构建并导出 <code>dsh-mobile-signed.ipa</code>；
6. 生成 <code>site/</code>：安装页、AltStore 源、OTA manifest、图标、截图；
7. 计算 SHA-256，上传 artifacts；
8. 在 tag 构建时创建 GitHub Release，并部署 GitHub Pages。

### 打 tag 的版本号

<code>v0.1.0</code> 会变成 <code>MARKETING_VERSION=0.1.0</code>。请使用数字 semver：

~~~text
v0.1.0
v0.2.0
v1.0.0
~~~

不要使用 <code>v0.1.0-ios</code> 这类 Xcode 不接受的版本号。

## 中继不在这里

GitHub Actions 是**构建和发布**流水线，不是常驻服务器。它不能托管手机到 DSH 的中继：

- 同一 Wi-Fi 由插件直接监听，不需要中继；
- 外网可用插件内置的 Cloudflare quick tunnel（<code>tunnel: quick</code>），或自建 HTTPS 反代/Tailscale，并设置 <code>publicUrl</code>；
- 中继必须跑在 Cloudflare、Tailscale 或你的 VPS 上，不能跑在 workflow 里。

详见 [外网访问与中继](remote-access.md)。

## 签名 Secrets

在 **Settings → Secrets and variables → Actions** 添加：

| Secret | 说明 |
| --- | --- |
| IOS_P12_BASE64 | .p12 证书的 base64 |
| IOS_P12_PASSWORD | .p12 密码 |
| IOS_MOBILEPROVISION_BASE64 | .mobileprovision 的 base64 |
| IOS_TEAM_ID | Apple Team ID |
| IOS_EXPORT_METHOD | ad-hoc（默认）、development、enterprise、app-store |
| IOS_BUNDLE_ID | 可选；覆盖 app.dsh.mobile |

只要 <code>IOS_P12_BASE64</code> 或 <code>IOS_MOBILEPROVISION_BASE64</code> 缺失，签名步骤就会整体跳过，仍然产出未签名 IPA 和 AltStore 源。

### ad-hoc 与 development

- <code>ad-hoc</code>：设备 UDID 必须在描述文件里；适合自己和朋友的设备。
- <code>development</code>：同样需要 UDID 和开发证书；一般用 Xcode 直接跑。
- <code>enterprise</code>：企业证书；注意合规和证书吊销风险。
- <code>app-store</code>：只能用于 App Store Connect 上传，不适合这里。

本项目不配置 TestFlight；如需 TestFlight，需要额外的 App Store Connect API key、bundle id 和审核流程。

### 生成 p12

钥匙串访问 → 我的证书 → 选中证书和私钥 → 导出 .p12。不要只导出证书。

### 描述文件名称

工作流会从 .mobileprovision 里读取 <code>Name</code> 和 <code>UUID</code>，然后：

- 把 profile 复制到 <code>~/Library/MobileDevice/Provisioning Profiles</code>；
- 用 <code>PROVISIONING_PROFILE_SPECIFIER</code> 引用 Name；
- 生成 ExportOptions.plist。

所以不需要手动填写 profile 名。

## GitHub Pages

安装页和 AltStore 源由 <code>scripts/make-site.mjs</code> 生成。

启用：

1. 仓库 **Settings → Pages**；
2. Source 选择 **GitHub Actions**（不是 “Deploy from a branch”）；
3. 运行一次 tag 构建；
4. workflow 里的 <code>deploy-pages</code> 会发布 <code>site/</code>。

### 常见误用：手动运行 main 不会发布

在 Actions 页面点 **Run workflow** 并选择 <code>main</code> 时：

- 会构建并上传 <code>dsh-mobile-ios</code> artifact；
- **不会**创建 GitHub Release；
- **不会**部署 Pages。

因为 Release/Pages 步骤的条件是 <code>refs/tags/*</code>。必须推送 tag：

~~~bash
git tag v0.1.0
git push origin v0.1.0
~~~

如果 Pages Source 还是 “Deploy from a branch”，访问 <code>https://OWNER.github.io/dsh-mobile/</code> 看到的是 Jekyll 渲染的仓库 README，而不是安装页；<code>/altstore.json</code> 也会 404。

默认地址：

~~~text
https://<owner>.github.io/<repo>/
https://<owner>.github.io/<repo>/altstore.json
~~~

自定义域名/自定义 Pages 地址时，在仓库 **Settings → Secrets and variables → Actions → Variables** 添加：

| Variable | 说明 |
| --- | --- |
| SITE_URL | 例如 https://dsh.example.com/ ，必须以斜杠结尾 |

工作流会把它传给安装页生成器，AltStore 源和 QR 也会使用它。

> GitHub Pages 只负责安装页和 AltStore 源；IPA 本体在 Release 资产里。私有仓库的 Release 资产需要登录，AltStore 无法直接下载，建议使用公开仓库或自己的静态文件服务器。

## Release 资产

tag 构建会创建 Release，包含：

- <code>dsh-mobile-unsigned.ipa</code>
- <code>dsh-mobile-signed.ipa</code>（如果签名成功）
- <code>SHA256SUMS.txt</code>
- <code>ios-onboarding.png</code>
- <code>altstore.json</code>
- <code>manifest.plist</code>（如果签名成功）
- <code>dsh-mobile-site.zip</code>

## Artifacts

即使不打 tag，每次运行也会上传：

~~~text
dsh-mobile-ios/
├─ dsh-mobile-unsigned.ipa
├─ dsh-mobile-signed.ipa (可选)
├─ SHA256SUMS.txt
├─ ios-onboarding.png
├─ site/
└─ xcodebuild-*.log
~~~

Artifacts 默认保留 30 天。

## 本地复现构建

~~~bash
pnpm install
node scripts/make-site.mjs
cd ios
xcodegen generate
xcodebuild -project dsh-mobile.xcodeproj -scheme dsh-mobile \
  -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ../dist/DerivedData-ios \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
~~~

或者：

~~~bash
MARKETING_VERSION=0.1.0 CURRENT_PROJECT_VERSION=1 \
  ios/scripts/build-ipa.sh unsigned "$PWD/dist/ios"
~~~

签名构建需要先导入证书、安装 profile，然后：

~~~bash
IOS_TEAM_ID=... IOS_PROFILE_NAME=... IOS_EXPORT_OPTIONS=... \
  ios/scripts/build-ipa.sh signed "$PWD/dist/ios"
~~~

## 故障排查

**XcodeGen 找不到**

~~~bash
brew install xcodegen
~~~

**xcodebuild 报 no signing certificate**

- 签名 secrets 是否完整；
- p12 是否包含私钥；
- 证书类型与 export method 是否匹配；
- 描述文件是否包含目标设备。

**Pages 部署失败**

- Settings → Pages 是否选择 GitHub Actions；
- workflow 是否有 <code>pages: write</code> 和 <code>id-token: write</code>；
- 仓库是否禁止 GitHub Pages。

**AltStore 下载 404**

- Release 是否存在，tag 是否匹配；
- 仓库是否私有；
- <code>SITE_URL</code> 与 Release 资产 URL 是否一致。

**外网二维码打不开**

- 这是插件侧的隧道/反代问题，不是 Actions 的问题；
- 看插件日志的 <code>quick tunnel ready</code> / <code>publicUrl</code>；
- 检查 Cloudflare/Tailscale/nginx 的 WebSocket upgrade 和 TLS。

**模拟器截图失败**

- runner 的 Xcode 版本是否支持 <code>generic/platform=iOS Simulator</code>；
- 是否有可用的 iPhone runtime；
- 看 <code>xcodebuild-sim.log</code>。
