# 外网访问与中继

## 先回答：为什么同一 Wi-Fi 不需要中继

dsh-mobile 的插件本身就是**服务端**。DSH 启动时，插件在本机监听 HTTP/WebSocket 端口（默认 47821），二维码里的 <code>u</code> 是电脑的局域网地址：

~~~text
iPhone  --Wi-Fi-->  192.168.1.20:47821  (dsh-mobile 插件 / DSH)
~~~

手机直接访问电脑，没有第三方。配对码、设备令牌和 WebSocket ticket 都在这个直连通道里完成。

但电脑通常在 NAT/防火墙后面，**手机不在同一局域网时无法直接访问这个内网地址**。这时才需要中继或隧道：

~~~text
iPhone --HTTPS/WSS--> 公网中继/隧道 --outbound--> 127.0.0.1:47821 (插件)
~~~

GitHub Actions 只负责打包 IPA，**不能托管中继**，因为它不是常驻服务器。中继必须跑在 Cloudflare、Tailscale 或你自己的 VPS 上。

## 方案对比

| 方案 | 需要什么 | 隐私 | 稳定性 | 适合 |
| --- | --- | --- | --- | --- |
| 同一 Wi-Fi 直连 | 无 | 最高，纯局域网 | 高 | 家里/办公室 |
| Cloudflare quick tunnel | 电脑装 cloudflared | Cloudflare 终止 TLS，能看到 HTTP | URL 每次变，有限流 | 临时外网调试 |
| 命名 Cloudflare Tunnel | 域名 + Cloudflare 账号 | 同上，可加 Access | 固定域名 | 个人长期使用 |
| Tailscale | 电脑和手机都装 Tailscale | WireGuard 端到端，推荐 | 高 | 隐私敏感 |
| frp / nginx 反代 | VPS + 域名 + TLS | 取决于你的服务器 | 取决于运维 | 完全自托管 |

## 方案 A：同一 Wi-Fi 直连（默认）

保持：

~~~yaml
tunnel: off
~~~

确保电脑防火墙允许 Node/DeepSeek Harness 访问专用网络，手机和电脑在同一网段。配对页里的 <code>phone URLs</code> 会列出可用地址。

## 方案 B：Cloudflare quick tunnel

适合临时在外面连回家，不需要域名和服务器。

1. 在电脑安装 cloudflared，并确认：

   ~~~powershell
   cloudflared --version
   ~~~

   Windows 也可以用 <code>winget install --id Cloudflare.cloudflared</code>，或从 Cloudflare 官网下载后把目录加入 PATH。

2. 修改 DSH 的 <code>cordis.patch.yml</code>（或插件配置）：

   ~~~yaml
   tunnel: quick
   # 不在 PATH 时指定绝对路径：
   # cloudflaredBinary: C:\Program Files (x86)\cloudflared\cloudflared.exe
   ~~~

3. 重启 DSH。日志会出现：

   ~~~text
   [dsh-mobile] starting Cloudflare quick tunnel
   [dsh-mobile] quick tunnel ready: https://xxxx.trycloudflare.com
   ~~~

   配对页二维码会自动使用这个 HTTPS 地址。手机用移动网络也能扫码连接。

4. 停止时插件会终止 cloudflared 子进程。

### 注意

- Quick tunnel 的域名**每次重启都会变化**。手机里保存的旧 profile 会失效，需要重新扫码。
- Cloudflare 对 quick tunnel 有限流，不适合长期生产使用。
- Cloudflare 终止 TLS 后会把 HTTP 转发给插件，因此 Cloudflare 理论上能看到请求内容。设备令牌仍然保护 API，但如果内容敏感，请用 Tailscale。
- 需要固定地址时，用命名隧道并设置 <code>publicUrl</code>。

## 方案 C：命名 Cloudflare Tunnel / 自有 HTTPS 反代

如果你已经有域名和反向代理（Cloudflare Named Tunnel、nginx、Caddy、frp + nginx 等），让公网 HTTPS 根路径指向本机桥接：

~~~text
https://dsh.example.com  ->  http://127.0.0.1:47821
~~~

必须支持 WebSocket upgrade，并允许较大的请求体（图片附件，默认上限 24 MB）。然后配置：

~~~yaml
publicUrl: https://dsh.example.com
tunnel: off
~~~

<code>publicUrl</code> 会同时用于二维码、配对页和 API 的 origin 提示。不要再让插件启动 quick tunnel。

> 如果给这个 hostname 开启 Cloudflare Access，iOS 原生壳的配对请求（URLSession）不会自动带 Access 登录 Cookie，可能被 302 到登录页。当前版本没有内置 Access service token 注入；要么关闭 Access、只依赖 dsh-mobile 的设备令牌，要么自己扩展原生请求头。

nginx 的关键配置：

~~~nginx
location / {
    proxy_pass http://127.0.0.1:47821;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 32m;
    proxy_read_timeout 3600s;
}
~~~

> 反代必须放在**根路径**，不要挂在 <code>/dsh/</code> 子路径下；移动 UI 和 API 使用根路径。

## 方案 D：Tailscale（推荐给个人长期使用）

Tailscale 组成一个私有 WireGuard 网络，不需要把端口暴露到公网。

1. 电脑和 iPhone 安装 Tailscale，登录同一个 tailnet。
2. 电脑上启动 Serve：

   ~~~bash
   tailscale serve --bg 47821
   ~~~

3. 记下 Tailscale 给出的 <code>https://机器名.tailnet.ts.net</code>，配置：

   ~~~yaml
   publicUrl: https://机器名.tailnet.ts.net
   tunnel: off
   ~~~

4. 手机扫码；之后无论在家还是外面，只要 Tailscale 在线就能连接。

Tailscale 的 TLS 在 Tailscale 侧终止，链路是 WireGuard 加密的，比把明文 HTTP 交给第三方中继更合适。

## 方案 E：完全自建 frp / nginx

如果你有自己的 VPS：

- 用 frp、rathole 或 WireGuard 把 VPS 的某个 HTTPS 入口转到电脑的 47821。
- 在 VPS 上用 Caddy/nginx 配好证书和 WebSocket。
- 在插件里设置 <code>publicUrl</code>，保持 <code>tunnel: off</code>。

这条路径需要你维护服务器、证书和访问控制。dsh-mobile 仓库**不包含**一个自建中继服务；它只提供客户端和可选的 Cloudflare 隧道接入。

## 首次配对必须在本机确认

管理页/配对页仍然只接受本机直接访问。也就是说：

- 建议先在家里/同一 Wi-Fi 下完成首次扫码和电脑端批准；
- 之后外出时通过 quick tunnel / 命名隧道 / Tailscale 继续使用已配对的设备；
- 不要为了“远程配对”把管理页反代到公网。当前版本没有远程管理面。

## 安全清单

- 公网入口必须是 HTTPS/WSS；不要直接暴露 <code>http://公网IP:47821</code>。
- 保持 <code>permissionMode: workspace-write</code>；不要为了方便长期开 <code>danger-full-access</code>。
- 配对页/管理页只监听 loopback，并拒绝带 <code>cf-connecting-ip</code>/<code>x-forwarded-for</code>/<code>forwarded</code> 的代理请求；即使通过隧道也打不开，不要把它反代到公网。
- 设备丢失时在电脑配对页吊销该设备。
- Quick tunnel 只用于临时使用；长期使用命名隧道或 Tailscale。
- 反代要限制请求体大小、设置超时，并只允许你自己的域名/网络。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 二维码仍是 192.168.x.x | 看日志是否有 <code>quick tunnel ready</code>；cloudflared 是否在 PATH |
| quick tunnel 启动失败 | 电脑能否访问 Cloudflare；<code>cloudflared tunnel --url http://127.0.0.1:47821</code> 手动试 |
| 手机能打开页面但 WebSocket 断开 | 反代是否配置 Upgrade/Connection；超时是否太短 |
| 配对后立刻 401 | 是否重启导致 quick tunnel URL 变化；重新扫码 |
| 图片上传失败 | 反代 <code>client_max_body_size</code> 是否小于 24 MB |
