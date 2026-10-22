# iOS 自签安装与信任

dsh-mobile 不经过 App Store。iOS 也不允许像 Android 那样直接安装一个未签名 IPA。下面每种方式都必须产生一个 iOS 信任的签名，只是签名由谁完成不同。

## 先认识三种产物

每次 **iOS Build & Self-hosted Release** 会生成：

| 产物 | 是否可直接安装 | 用途 |
| --- | --- | --- |
| dsh-mobile-unsigned.ipa | 否 | 交给 AltStore / SideStore / Sideloadly / 你自己的证书重签 |
| dsh-mobile-signed.ipa | 取决于证书 | 用工作流 secrets 里的证书和描述文件导出的 ad-hoc / development / enterprise 包 |
| dsh-mobile.app（模拟器） | 仅模拟器 | 在 macOS 的 iOS Simulator 里预览；CI 用它截图 |

“自签安装”不是把 IPA 拖进手机，而是：

1. 在电脑或手机上用你的 Apple ID / 证书对 IPA 重签；
2. 安装重签后的包；
3. 在 **设置 → 通用 → VPN 与设备管理** 里信任对应的开发者证书；
4. 打开 App，扫码配对。

## 方式 A：AltStore / SideStore（推荐，无需开发者账号）

AltStore 和 SideStore 都使用你的免费 Apple ID 在设备上重签。免费账号的签名 7 天过期，AltStore 会在后台刷新；SideStore 需要先完成配对文件。

1. 在 GitHub 仓库启用 Pages：**Settings → Pages → Source: GitHub Actions**。
2. 打一个 <code>v0.1.0</code> 标签，或手动运行 iOS workflow。
3. 等 **Deploy to GitHub Pages** 成功。
4. 安装页地址：

   ~~~text
   https://YOUR_NAME.github.io/dsh-mobile/
   ~~~

5. AltStore 源地址：

   ~~~text
   https://YOUR_NAME.github.io/dsh-mobile/altstore.json
   ~~~

6. 在 AltStore 的 **Sources → +** 里粘贴源地址；SideStore 同理。
7. 在源里点 **dsh-mobile → Install**。
8. 首次安装后，如果系统提示“不受信任的开发者”，去 **设置 → 通用 → VPN 与设备管理 → 开发者 App** 点信任。
9. 打开 App，扫描电脑配对页二维码。

> 安装页上的“下载未签名 IPA”只是给自签工具用的，Safari 直接点它不会安装。
> AltStore/SideStore 会重新签名，所以 IPA 本身未签名并不影响这条路。

## 方式 B：用自己的证书签名（GitHub Actions）

适合你有 Apple Developer Program（或企业证书）并且设备 UDID 已加入 ad-hoc 描述文件的情况。

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| IOS_P12_BASE64 | 是 | 导出为 .p12 的签名证书，base64 编码 |
| IOS_P12_PASSWORD | 是 | p12 密码 |
| IOS_MOBILEPROVISION_BASE64 | 是 | .mobileprovision 文件的 base64 |
| IOS_TEAM_ID | 是 | Apple Team ID |
| IOS_EXPORT_METHOD | 否 | 默认 ad-hoc；也可用 development / enterprise / app-store |
| IOS_BUNDLE_ID | 否 | 覆盖 app.dsh.mobile；必须和描述文件一致 |

生成 base64：

~~~bash
base64 -i Certificates.p12 | pbcopy
base64 -i profile.mobileprovision | pbcopy
~~~

Windows：

~~~powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("Certificates.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("profile.mobileprovision")) | Set-Clipboard
~~~

工作流会：

1. 把证书导入临时 keychain；
2. 把描述文件安装到 runner；
3. 用 <code>xcodebuild archive</code> + <code>-exportArchive</code> 导出 IPA；
4. 生成 <code>manifest.plist</code> 和安装页上的“直接安装已签名 IPA”按钮。

注意：

- <code>ad-hoc</code> 只能安装到描述文件里列出的设备；不是通用包。
- 企业证书可以 OTA 给任意设备，但需要符合 Apple 的企业证书条款，且证书被吊销会导致已安装 App 失效。
- 免费 Apple ID 无法在 GitHub Actions 上完成签名；免费账号请使用 AltStore/SideStore。

## 方式 C：本地自签工具

如果你不想用 AltStore：

- **Sideloadly**（Windows/macOS）：拖入未签名 IPA + Apple ID，连接手机安装。
- **Apple Configurator**（macOS）：需要已签名的 IPA。
- **Xcode**：打开工程，设置自己的 Team，直接 Run 到真机。
- **SideStore**：在设备上重签，需要配对文件。

免费 Apple ID 的限制：

- 每 7 天需要重新签名；
- 同时最多 3 个自签 App；
- 不能使用某些需要付费账号的 entitlement（本项目没有使用）。

## 方式 D：TrollStore

TrollStore 利用系统漏洞，在受支持的 iOS 版本上可以直接安装未签名 IPA，且不会过期。

- 只适用于特定 iOS 版本范围；
- 不是所有设备/系统都支持；
- 本项目不附带 TrollStore，也不建议在主力机上使用不受支持的漏洞工具；
- 如果你的设备支持，直接安装 <code>dsh-mobile-unsigned.ipa</code> 即可。

## 信任证书

安装完成后，第一次打开 App 可能提示：

> 不受信任的开发者

处理：

1. 打开 **设置 → 通用 → VPN 与设备管理**。
2. 在 **开发者 App** 下找到对应的 Apple ID / 企业名称。
3. 点 **信任**。
4. 回到桌面打开 dsh-mobile。

如果找不到开发者项，说明安装没有完成或描述文件未生效；重新安装。

## 首次启动

App 会请求：

- **相机**：扫描配对二维码。
- **本地网络**：访问电脑上的桥接服务。
- **相册**：发送图片给本机 DSH。

都建议允许。如果拒绝了相机，可以到系统设置里重新打开；扫码页会提供跳转按钮。

## 配对前检查

- 手机和电脑在同一个 Wi-Fi（不要用访客网络/AP 隔离）。
- 电脑上的 DSH 插件已加载，日志里有 <code>bridge ready</code> 和 <code>phone URLs</code>。
- 手机浏览器能打开：

  ~~~text
  http://<电脑局域网 IP>:47821/api/health
  ~~~

- 电脑防火墙允许该端口。
- 如果使用 <code>publicUrl</code>，手机能访问该 HTTPS 域名。

## 常见问题

**AltStore 显示 “The source could not be loaded”**

- 确认 Pages 已成功部署。
- 在手机浏览器打开 <code>/altstore.json</code>，应返回 JSON。
- 确认 <code>downloadURL</code> 指向公开 Release 资产；私有仓库需要登录，AltStore 无法下载。

**安装时提示 “Unable to Install” / “App is not available”**

- 描述文件不包含这台设备（ad-hoc）。
- 证书被吊销或过期。
- 免费 Apple ID 的 7 天签名过期，重新签名/刷新。
- Bundle ID 与描述文件不一致（检查 <code>IOS_BUNDLE_ID</code>）。

**安装后闪退**

- 看 Xcode → Devices 的崩溃日志，或 CI 的 simulator 构建日志。
- 最常见原因是签名/描述文件 entitlement 不匹配。
- 模拟器构建不能直接安装到真机；必须用 device 构建的 IPA。

**App 打开是白屏 / 立刻显示连接错误**

- 检查配对页 URL 是否在手机浏览器可访问。
- 电脑上是否运行着插件（不是旧的桌面 DSH 进程）。
- 令牌是否被吊销；在电脑配对页移除设备，重新扫码。

**扫码没反应**

- 相机权限是否允许。
- 二维码是否来自当前运行中的插件（配对码 10 分钟过期）。
- 二维码是否被截断/打印模糊；改用手动输入地址 + 配对码。

**一直提示“等待电脑确认”**

- 电脑配对页是否显示了 pending 请求？
- 是否点了「允许连接」？
- 请求 3 分钟后过期；重新扫码。
