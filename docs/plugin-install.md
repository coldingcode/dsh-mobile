# 在 DSH 中安装、升级与配置插件

dsh-mobile 的根目录本身就是一个 DSH bundle 包：

~~~json
{
  "name": "dsh-mobile",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
~~~

<code>lib/</code> 和 <code>web-dist/</code> 是提交到仓库的构建产物，这样从 GitHub 安装时不需要在用户机器上再执行构建。

## 前置条件

- DSH 0.2.1-rc.2 或兼容的 0.2.x（<code>engines.dsh</code> 声明为 <code>&gt;=0.2.1-rc.2 &lt;0.3.0</code>）
- Node 22+
- 默认要求电脑和手机在同一局域网；外网访问可用 <code>tunnel: quick</code> 或 <code>publicUrl</code>（见 [外网访问](remote-access.md)）
- 插件运行时能访问 <code>dsh --profile sdk</code>。桌面版会优先使用安装目录里的 CLI；如果找不到，会回退到 PATH 上的 <code>dsh</code>

## 方式 A：一键安装脚本

### Windows

在仓库根目录：

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-plugin.ps1 -Local
~~~

从 GitHub：

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-plugin.ps1 -Source github:YOUR_NAME/dsh-mobile
~~~

脚本会优先找 PATH 上的 <code>dsh</code>；找不到时会尝试：

- <code>%ProgramFiles%\DeepSeek Harness</code>
- <code>%LOCALAPPDATA%\Programs\DeepSeek Harness</code>

并直接用 Electron 的 Node 模式运行 CLI。

### macOS

~~~bash
chmod +x scripts/install-plugin.sh
./scripts/install-plugin.sh --local
# 或
./scripts/install-plugin.sh github:YOUR_NAME/dsh-mobile
~~~

找不到 <code>dsh</code> 时会尝试 <code>/Applications/DeepSeek Harness.app</code>。

## 方式 B：DSH Plugins 页面

1. 打开 DSH 的 **Settings → Plugins**。
2. 选择安装外部 bundle。
3. 输入仓库地址：<code>github:YOUR_NAME/dsh-mobile</code>，或本地 <code>link:D:\path\to\dsh-mobile</code>。
4. 安装完成后启用 <code>dsh-mobile</code> bundle。
5. 重启 DSH。

插件管理底层执行的是：

~~~bash
dsh plugin --profile desktop add github:YOUR_NAME/dsh-mobile
~~~

profile 名可能是 <code>desktop</code>、<code>web</code>、<code>tui</code>，取决于你运行的 DSH。

## 方式 C：手动编辑 profile patch

如果你不想通过插件管理器，可以：

1. 把包安装到 profile 的依赖里（或使用 <code>link:</code>）。
2. 在 profile 的 <code>cordis.patch.yml</code> 中追加：

~~~yaml
- insert:
    - id: dsh-mobile
      name: dsh-mobile
      config:
        port: 47821
        bindHost: 0.0.0.0
        permissionMode: workspace-write
        provider: deepseek-official
        model: deepseek-flash
        tunnel: off
        openPairingPage: true
        printTerminalQr: true
~~~

Windows 的 desktop profile 通常在：

~~~text
C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml
~~~

macOS/Linux：

~~~text
~/.dsh/profiles/desktop/cordis.patch.yml
~~~

profile 的 <code>package.json</code> 里还需要有依赖或 link。插件管理器的安装步骤会处理这些。

## 重启后确认

DSH 日志里应出现：

~~~text
[dsh-mobile] bridge ready on http://192.168.1.20:47821 (bind 0.0.0.0:47821)
[dsh-mobile] permission=workspace-write workspace=D:\dev\project
[dsh-mobile] pairing page: http://127.0.0.1:47821/pair?admin=...
[dsh-mobile] phone URLs: http://127.0.0.1:47821  http://192.168.1.20:47821
~~~

如果启用了 quick tunnel，还会看到：

~~~text
[dsh-mobile] quick tunnel ready: https://xxxx.trycloudflare.com
~~~

如果只看到 127.0.0.1，说明没有检测到局域网地址；检查网卡、防火墙，或设置 <code>publicUrl</code>/<code>tunnel: quick</code>。

## 配置项

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| port | number | 47821 | 监听端口；0 表示随机 |
| bindHost | string | 0.0.0.0 | 监听地址 |
| publicUrl | string | 未设置 | 固定的手机侧根 URL，例如 https://dsh.example.com |
| tunnel | string | off | quick = 启动 Cloudflare quick tunnel；与 publicUrl 二选一 |
| cloudflaredBinary | string | cloudflared | cloudflared 可执行文件路径 |
| workspace | string | process.cwd() | 默认工作目录 |
| provider | string | deepseek-official | SDK 模型 provider |
| model | string | deepseek-flash | SDK 模型 |
| permissionMode | string | workspace-write | 或 danger-full-access |
| serverName | string | 主机名 | 配对页/手机显示名 |
| stateDir | string | $DSH_HOME/dsh-mobile | 状态目录 |
| openPairingPage | boolean | true | 自动打开本机配对页 |
| printTerminalQr | boolean | true | 日志打印终端 QR |
| autoApprove | boolean | false | 仅开发用 |
| allowBrowserPairing | boolean | true | 允许浏览器手动配对 |
| pairingCodeTtlSeconds | number | 600 | 配对码有效期 |
| pairRequestTtlSeconds | number | 180 | 请求有效期 |
| maxPairAttempts | number | 8 | 时间窗内每 IP 的尝试上限 |
| pairAttemptWindowSeconds | number | 600 | 限流时间窗 |
| maxBodyBytes | number | 24 MB | HTTP body 上限 |
| sdkCommand | string | 自动 | 覆盖 SDK 启动命令 |
| sdkArgs | string[] | 自动 | 覆盖 SDK 启动参数 |

环境变量覆盖（同名逻辑）：<code>DSH_MOBILE_PORT</code>、<code>DSH_MOBILE_BIND</code>、<code>DSH_MOBILE_PUBLIC_URL</code>、<code>DSH_MOBILE_TUNNEL</code>、<code>DSH_MOBILE_CLOUDFLARED</code>、<code>DSH_MOBILE_WORKSPACE</code>、<code>DSH_MOBILE_PERMISSION_MODE</code>、<code>DSH_MOBILE_PROVIDER</code>、<code>DSH_MOBILE_MODEL</code>、<code>DSH_MOBILE_SERVER_NAME</code>、<code>DSH_MOBILE_STATE_DIR</code>、<code>DSH_MOBILE_OPEN_PAIRING_PAGE</code>、<code>DSH_MOBILE_PRINT_QR</code>、<code>DSH_MOBILE_AUTO_APPROVE</code>、<code>DSH_MOBILE_SDK_COMMAND</code>、<code>DSH_MOBILE_SDK_ARGS</code>。

## 状态目录

~~~text
$DSH_HOME/dsh-mobile/
├─ state.json          bridgeId（指纹）
├─ devices.json        设备令牌哈希 + 元数据
└─ sessions/
   ├─ <session-id>.json
   └─ ...
~~~

- 删除 <code>devices.json</code> 会吊销所有手机（需要重启插件）。
- 删除某个 session 文件只影响手机端历史，不影响 DSH 自身的会话日志。
- 不建议在插件运行时手工改这些文件。

## 升级

- 从 GitHub 安装：重新执行安装命令，或在插件管理器中更新。
- 本地 link：更新代码后执行 <code>pnpm build</code>，然后重启 DSH。
- 升级不会清除 <code>$DSH_HOME/dsh-mobile</code>；已配对设备会保留。

## 卸载

1. 在 DSH Plugins 页面禁用并移除 <code>dsh-mobile</code>，或从 profile 的 <code>package.json</code> / patch 中移除。
2. 重启 DSH。
3. 如需清理：删除 <code>$DSH_HOME/dsh-mobile</code>。

## 常见问题

**配对页打不开**

- 确认 DSH 日志里有 <code>pairing page</code>。
- 是否设置了 <code>openPairingPage: false</code>？
- 是否在远程 SSH / 无桌面环境运行？手动复制日志里的 loopback URL。

**手机扫码后连接失败**

- 如果是外网，日志里是否有 <code>quick tunnel ready</code>，或 <code>publicUrl</code> 是否指向当前反代？
- 手机和电脑是否在同一个 Wi-Fi？
- Windows 防火墙是否允许 Node/DeepSeek Harness 的专用网络入站？
- 电脑是否开了 VPN 导致局域网地址变化？设置 <code>serverName</code>/<code>publicUrl</code> 或关闭 VPN。
- 检查 <code>http://&lt;电脑IP&gt;:47821/api/health</code> 是否能在手机浏览器打开。

**手机显示“运行时错误”**

- 电脑上的 DSH 是否还在运行？
- 日志里是否有 <code>runtime: packaged ...</code> 或 <code>dsh: command not found</code>？
- 可以设置 <code>sdkCommand</code> 和 <code>sdkArgs</code> 指向可用的 CLI。

**需要审批的工具总是失败**

这是当前的设计：SDK 没有手机端审批回调，<code>workspace-write</code> 下需要审批的操作 fail closed。可以在可信网络中临时使用 <code>danger-full-access</code>。

**如何只允许特定网络访问**

不要绑定 <code>0.0.0.0</code>；把 <code>bindHost</code> 设为某个具体局域网 IP，或用防火墙限制端口。<code>publicUrl</code> 只影响 URL，不改变监听范围。
