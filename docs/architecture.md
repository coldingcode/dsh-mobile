# 架构与数据流

dsh-mobile 的目标是把**本机** DSH 的执行能力带到一个受信任的手机上，同时不把模型密钥、工作区文件或命令执行搬到手机上。

## 总览

~~~text
┌────────────────────────── 电脑 ──────────────────────────┐
│ DeepSeek Harness (Electron / Node 22)                    │
│                                                           │
│  dsh-mobile 插件（Cordis bundle）                         │
│  ├─ BridgeServer        node:http + ws                    │
│  ├─ PairingService      配对码 / 6 位核对 / 设备令牌       │
│  ├─ JournalStore        会话摘要 + 事件抽屉（JSON 文件）   │
│  └─ SdkRuntime          spawn dsh --profile sdk           │
│                                                           │
│  DSH SDK 子进程（stdio JSON-RPC）                         │
│  ├─ initialize                                            │
│  ├─ session/prompt / session/resume                       │
│  └─ session.event / session.status / subagent.*           │
└──────────────────────────────┬────────────────────────────┘
                               │ 局域网 HTTP + WebSocket
                               │ Bearer token / one-time ticket
┌──────────────────────────────┴────────────────────────────┐
│ iPhone                                                    │
│  SwiftUI 壳                                                │
│  ├─ Onboarding / Scanner / PairingFlow                    │
│  ├─ KeychainStore                                         │
│  ├─ WebShellView → WKWebView                              │
│  └─ NativeShellSettings                                   │
│                                                           │
│  WKWebView（插件托管的 React 移动 UI）                     │
│  ├─ 会话 / 对话 / 活动 / 设置                              │
│  ├─ WebSocket 实时事件                                     │
│  └─ Liquid Glass 设计系统                                  │
└───────────────────────────────────────────────────────────┘
~~~

## 为什么拆成插件 + SDK 子进程

DSH 的桌面/Web 进程很重，且 Web GUI 的会话 API 是面向浏览器的私有组合。直接复用内部 API 会带来版本耦合和认证问题。

dsh-mobile 选择官方 **SDK stdio JSON-RPC** 作为集成面：

- 稳定、有文档、与桌面进程隔离；
- 子进程崩溃不会拖垮 DSH；
- 可以在不修改 DSH 核心的情况下升级；
- 权限模式通过 <code>DSH_PERMISSION_MODE</code> 传给 SDK profile。

代价是这是**第二个 SDK 运行时**，不会自动镜像桌面当前打开的会话。手机端有独立的会话索引和事件日志。

## 启动顺序

1. Cordis 加载 bundle patch，实例化 <code>dsh-mobile</code> 行。
2. 插件解析配置和环境变量，创建 <code>MobileBridge</code>。
3. 读取 <code>$DSH_HOME/dsh-mobile/devices.json</code> 和 <code>sessions/*.json</code>。
4. 在配置端口监听；忙则尝试后续 9 个端口，再退到随机端口。
5. 构造配对码、管理令牌和二维码；打印日志，可选自动打开本机配对页。
6. 手机首次连接时，SDK 子进程才会被懒启动。

## 配对

~~~text
电脑配对页                     手机 App                        Bridge
    │                            │                               │
    │  展示 QR：u + c + n + f     │                               │
    │───────────────────────────>│                               │
    │                            │ POST /api/pair/request        │
    │                            │  {code, deviceId, name}       │
    │                            │──────────────────────────────>│
    │                            │<── {requestId, 6 位核对码}     │
    │  轮询 /admin/state           │                               │
    │  看到 pending + 核对码       │  手机显示核对码                │
    │  点「允许」                  │                               │
    │  POST /admin/.../approve    │                               │
    │──────────────────────────────────────────────────────────>│
    │                            │  轮询 /api/pair/request/:id    │
    │                            │──────────────────────────────>│
    │                            │<── {status:approved, token}    │
    │                            │  Keychain 保存                │
~~~

- 配对码：8 位 Crockford 字符，10 分钟轮换；每次扫描的 QR 都包含当前码。
- 请求：3 分钟过期，同一 deviceId 的旧 pending 会被替换。
- 核对码：6 位数字，同时显示在电脑和手机上。电脑端批准才会签发令牌。
- 令牌：<code>dshm_</code> + 32 字节随机数；服务端存储 SHA-256 哈希，不存明文。
- 管理页：只接受 loopback，且需要每次进程启动随机生成的 admin token。

## 认证与会话

手机 Web UI 和原生壳使用同一个设备令牌：

- HTTP：<code>Authorization: Bearer &lt;token&gt;</code>，或在配对后用 HttpOnly Cookie。
- WebSocket：先 <code>POST /api/ws-ticket</code> 获取 30 秒一次性 ticket，再连接 <code>/ws?ticket=...</code>；避免把长期令牌放进 URL。
- 浏览器回退：<code>POST /api/auth/session</code> 把令牌换成 HttpOnly SameSite=Strict Cookie。
- 所有设备令牌都可被电脑配对页吊销。

## 事件日志（JournalStore）

SDK 只会发送**已经提交**的 session event。JournalStore 把原始事件归一化成手机 UI 需要的条目：

| UI 条目 | 来源 |
| --- | --- |
| user | <code>user/message</code>（source.kind = user） |
| assistant | <code>assistant/message</code> |
| tool | <code>tool/call</code> → <code>tool/result</code>（同一 callId 更新） |
| notice | <code>turn/end</code> 失败、<code>approval/*</code>、压缩、计划模式等 |
| subagent | <code>subagent.started</code> / <code>subagent.finished</code> |

- 文件：<code>$DSH_HOME/dsh-mobile/sessions/&lt;session-id&gt;.json</code>
- 每个文件保存 <code>session</code> 摘要、<code>entries</code>、<code>nextOrder</code>。
- 每个会话最多保留 600 条；超出后标记 <code>truncated</code>。
- 写入使用临时文件 + rename 的原子写，150ms 防抖。
- 重启后 <code>running</code> 一律恢复为 <code>idle</code>（因为运行时已停止）。

## 运行时生命周期

- 懒启动：第一次 prompt、设置工作目录或会话恢复时启动。
- 握手：<code>initialize { cwd, provider, model }</code>，等待 <code>deepseek-harness-sdk-runtime</code>。
- 恢复：手机重启/插件重启后，对已有 <code>hasSdkSession</code> 的会话先 <code>session/resume</code>，再 prompt。
- 停止：SDK 没有单轮取消。Stop 会重启子进程，再尽量 resume 之前打开的会话。UI 会明确提示“所有进行中的会话都会中断”。
- 超时：普通请求 30s，prompt 120s，initialize 90s。
- 退出：stderr 保留最后 40 行用于错误展示；子进程退出会广播 <code>runtime.status = error</code>。

## 静态资源

- 插件从 <code>web-dist/</code> 读取构建后的 UI。
- SPA fallback 只在没有扩展名时回退到 <code>index.html</code>。
- 路径经过 resolve + 前缀校验，阻止目录穿越。
- CSP 限制脚本为 <code>'self'</code>，图片允许 <code>data:</code>/<code>blob:</code>，连接允许 <code>ws:</code>/<code>wss:</code>。
- 配对页使用独立的 CSP（因为包含内联脚本）。

## 失败模式

| 失败 | 表现 |
| --- | --- |
| 端口被占用 | 自动换端口；日志打印实际端口 |
| 电脑休眠/网络切换 | App WebSocket 自动重连；重连后重新拉 bootstrap |
| SDK 子进程崩溃 | 运行中会话标记 error；下一条消息会重新启动运行时 |
| DSH 未安装 / CLI 找不到 | 插件日志报错；App 显示“无法启动本机 DSH 运行时” |
| 令牌被吊销 | App 收到 401，显示重新配对页 |
| 配对码过期 | 手机收到 403，提示刷新电脑配对页 |
| WebSocket 丢事件 | 客户端重连后通过 REST 拉取完整会话，补齐缺口 |

## 性能

- Web UI 首次加载 <code>web-dist</code> 约 0.5 MB JS + 54 KB CSS（gzip 后约 150 KB）。
- 事件日志按会话拆分，不一次性扫描所有历史。
- 图片在手机端先缩放到最长边 1600px、JPEG 0.82 再上传，避免大图占满局域网。
- WebSocket 发送使用 JSON；超过 4 MB 缓冲的慢客户端会被断开并让客户端重连补数据。
