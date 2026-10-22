# 配对协议与 API

本文记录 dsh-mobile 手机端、桥接服务和电脑配对页之间的 HTTP / WebSocket 契约。协议版本为 1。

## 二维码

手机扫描到的文本：

~~~text
dshm://pair?d=<base64url(JSON)>
~~~

JSON：

~~~json
{
  "v": 1,
  "u": "http://192.168.1.20:47821",
  "c": "7KQ2-9W6M",
  "n": "Studio 的 MacBook",
  "exp": 1792662114205,
  "f": "dshm1-2bda8eb4f038"
}
~~~

| 字段 | 说明 |
| --- | --- |
| v | 固定 1 |
| u | 桥接根地址（局域网 IP、固定 publicUrl，或 tunnel: quick 生成的 https://*.trycloudflare.com） |
| c | 当前 8 位配对码，显示为 XXXX-XXXX |
| n | 服务器显示名 |
| exp | 配对码过期时间（Unix 毫秒） |
| f | 非密钥指纹，用于显示和去重 |

也支持把 base64url 字符串直接作为 QR 内容，方便自定义生成器。

配对码字符集去掉了 <code>I/L/O/U</code>，输入时会被归一化为 <code>1/1/0/V</code>。

## 公开端点（未认证）

### GET /api/health

~~~json
{
  "ok": true,
  "app": "dsh-mobile",
  "version": "0.1.0",
  "protocol": 1,
  "serverName": "Studio",
  "platform": "win32",
  "hostname": "dsj",
  "permissionMode": "workspace-write",
  "workspace": "D:\\dev\\project",
  "model": "deepseek-flash",
  "provider": "deepseek-official"
}
~~~

### GET /api/pair/info?code=XXXX-XXXX

用于手动输入时先校验码是否有效。

~~~json
{
  "serverName": "Studio",
  "version": "0.1.0",
  "platform": "win32",
  "protocol": 1,
  "validCode": true,
  "expiresAt": 1792662114205
}
~~~

### POST /api/pair/request

~~~json
{
  "code": "7KQ2-9W6M",
  "deviceId": "3B3E...-UUID",
  "deviceName": "iPhone 16 Pro",
  "platform": "iOS",
  "appVersion": "0.1.0 (42)"
}
~~~

返回：

~~~json
{
  "requestId": "bf9a896d-a098-4f52-a4cd-f149a3d136af",
  "verificationCode": "669627",
  "expiresAt": 1792662114205,
  "serverName": "Studio",
  "serverUrl": "http://192.168.1.20:47821"
}
~~~

- 请求 3 分钟过期。
- 同一 deviceId 的旧 pending 会被替换。
- 每个 IP 在 10 分钟内最多 8 次配对尝试（可配置）。
- 错误码：<code>pair-code-invalid</code>、<code>pair-rate-limited</code>、<code>device-invalid</code>。

### GET /api/pair/request/:requestId

手机轮询：

~~~json
{
  "status": "pending"
}
~~~

允许后第一次轮询返回令牌：

~~~json
{
  "status": "approved",
  "token": "dshm_...",
  "tokenExpiresAt": 1800000000000,
  "device": {
    "id": "3B3E...-UUID",
    "name": "iPhone 16 Pro",
    "platform": "iOS",
    "createdAt": 1792662000000,
    "lastSeenAt": 1792662000000
  }
}
~~~

令牌只返回一次；之后的轮询只返回 <code>approved</code> 状态。手机必须立即保存到钥匙串。

拒绝/过期：

~~~json
{ "status": "denied", "reason": "电脑端拒绝了这次配对" }
{ "status": "expired", "reason": "配对请求已过期" }
~~~

## 设备认证

以下端点需要：

- <code>Authorization: Bearer dshm_...</code>，或
- 浏览器配对后由 <code>/api/auth/session</code> 写入的 <code>dshm_session</code> HttpOnly Cookie。

### POST /api/auth/session

仅用于浏览器回退：

~~~json
{ "token": "dshm_..." }
~~~

成功后设置 <code>dshm_session</code>（Path=/、HttpOnly、SameSite=Strict、180 天；HTTPS 时带 Secure）。

### GET /api/bootstrap

~~~json
{
  "protocol": 1,
  "appVersion": "0.1.0",
  "server": { "...": "ServerInfo" },
  "config": {
    "serverName": "Studio",
    "workspace": "D:\\dev\\project",
    "provider": "deepseek-official",
    "model": "deepseek-flash",
    "permissionMode": "workspace-write",
    "pairingCodeTtlSeconds": 600,
    "allowBrowserPairing": true
  },
  "device": { "...": "DeviceInfo" },
  "sessions": [ "...": "SessionSummary" ],
  "features": { "images": true, "stop": true, "activity": true }
}
~~~

### POST /api/ws-ticket

~~~json
{ "ticket": "random", "expiresAt": 1792662000000 }
~~~

ticket 30 秒有效、一次性。

### 会话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/sessions | 会话摘要列表 |
| POST | /api/sessions | 新建：<code>{ title?, cwd? }</code> |
| GET | /api/sessions/:id | 摘要 + entries |
| PATCH | /api/sessions/:id | 重命名：<code>{ title }</code> |
| DELETE | /api/sessions/:id | 只从手机端移除，不删除 DSH 日志 |
| POST | /api/sessions/:id/prompt | 发送消息 |
| POST | /api/sessions/:id/stop | 重启运行时，停止所有运行中会话 |
| GET | /api/activity | 最近工具调用（最多 120 条） |
| POST | /api/logout | 吊销当前设备令牌并清 Cookie |

Prompt 请求：

~~~json
{
  "contentBlocks": [
    { "type": "text", "text": "跑一下测试" }
  ]
}
~~~

也支持图片：

~~~json
{ "type": "image", "data": "<base64 JPEG>", "mimeType": "image/jpeg" }
~~~

限制：1–8 个 block；文本最多 120000 字符；单图 base64 最多约 12 MB；总大小 16 MB。

响应：

~~~json
{
  "ok": true,
  "messageId": "8a952161-39b0-4dfa-a10c-9f1959e7bf22",
  "session": { "...": "SessionSummary" }
}
~~~

## 管理端点（仅 loopback）

管理页 <code>/pair?admin=...</code> 需要 loopback，并且 admin token 必须匹配（query 参数 <code>admin</code> 或 header <code>x-dsh-mobile-admin</code>）。带 <code>cf-connecting-ip</code>、<code>x-forwarded-for</code>、<code>x-real-ip</code> 或 <code>forwarded</code> 的代理请求会被拒绝，避免隧道把管理面暴露出去。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /pair?admin=... | 配对 HTML 页面 |
| GET | /admin/state | 当前配对码、pending、设备、指纹 |
| GET | /admin/qr.svg | 二维码 SVG |
| POST | /admin/rotate | 刷新配对码 |
| POST | /admin/requests/:id/approve | 允许设备 |
| POST | /admin/requests/:id/deny | 拒绝 |
| POST | /admin/devices/:id/revoke | 移除设备 |

## WebSocket

连接：

~~~text
ws://<host>:<port>/ws?ticket=<one-time-ticket>
~~~

客户端只发送心跳：

~~~json
{ "type": "ping", "time": 1792662000000 }
~~~

服务端事件：

| type | 说明 |
| --- | --- |
| hello | 协议、服务器、配置、运行时状态 |
| session.upsert | 会话摘要新增/更新 |
| session.entry | 单条消息/工具卡片新增或更新（按 id 合并） |
| session.status | running / idle / error |
| session.remove | 从手机端移除 |
| runtime.status | stopped / starting / ready / error |
| pong | 心跳回复 |

客户端断线后应重新拉 <code>/api/bootstrap</code> 和当前会话详情补缺口；服务端不为每个事件做 ACK。

## 错误格式

~~~json
{
  "error": "pair-code-invalid",
  "message": "配对码无效或已过期，请刷新电脑上的二维码"
}
~~~

常见错误码：

- <code>unauthorized</code>：缺少/无效设备令牌
- <code>pair-code-invalid</code>：配对码错误或过期
- <code>pair-rate-limited</code>：配对尝试过于频繁
- <code>pair-request-expired</code>：请求过期
- <code>session-running</code>：会话正在运行，不能删除
- <code>prompt-failed</code>：SDK 运行时未启动或 prompt 失败
- <code>body-too-large</code>：请求体超限
- <code>loopback-only</code>：管理接口被非本机访问

## 安全说明

- 配对码不是长期凭证；它只用于发起一次请求。
- 设备令牌是高熵随机串，服务端仅存哈希。
- 管理页 admin token 每次进程启动重新生成，不写盘。
- 默认明文 HTTP 只用于局域网；跨公网请使用 HTTPS 终止代理并设置 <code>publicUrl</code>，或显式启用 <code>tunnel: quick</code>。
- quick tunnel 由 Cloudflare 终止 TLS，Cloudflare 能看到解密后的 HTTP；设备令牌和配对码仍是应用层保护。隐私敏感场景请用 Tailscale/自建反代。
- 不要通过不可信网络分享带 admin token 的配对 URL。
