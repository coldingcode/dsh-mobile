# 设计系统：iOS 26 Liquid Glass

dsh-mobile 的目标不是“套一个深色主题”，而是把 iOS 26 的 Liquid Glass 语言落地成可维护的设计系统：

- 玻璃是**多层**的，不是单一模糊；
- 信息层级靠**材质、留白和字重**，不是靠粗边框；
- 动效有**物理感**，但尊重“减少动态效果”；
- 原生壳和 Web UI 使用同一套 tokens。

## 三层玻璃

~~~css
/* 折射层 */
background: linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.035));
backdrop-filter: blur(30px) saturate(180%);

/* 高光层：左上角镜面渐变 */
/* 边缘层：1px 半透明描边 + inset 1px 高光 */
border: 1px solid rgba(255,255,255,.14);
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.2),
  0 24px 60px rgba(0,0,0,.35);
~~~

Web 实现位于 <code>src/web/src/styles/glass.css</code>，SwiftUI 对应 <code>GlassCardModifier</code>。

## 颜色

| Token | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| bg | #050509 | #EEF0F7 | 页面底色 |
| ink | #F7F7FB | #14141F | 主文字 |
| muted | 白 56% | 黑 58% | 次要文字 |
| accent | #7C8CFF | #5A6CF0 | 主强调 |
| accent2 | #58D8FF | #0FA6CF | 信息/运行中 |
| accent3 | #C084FC | #9B5CF6 | 子代理 |
| green | #5EE6A8 | #12A86B | 成功/连接 |
| red | #FF6B81 | #E1405B | 错误 |
| yellow | #FFD479 | #B97B0A | 警告/完整访问 |

渐变：

- 用户气泡：#7181FF → #4D5DE3
- 品牌图标：#8E9CFF → #5364EA → #1A2046
- Aurora：靛蓝、青色、品红三个大模糊圆

## 字体

- 正文：系统 SF Pro / PingFang SC
- 品牌标题：<code>design: .rounded</code>，字距 -1.2 ~ -1.4
- 等宽：SF Mono，用于模型名、路径、配对码、计时
- 大标题 34–44pt；对话正文 14.5pt；辅助文字 10.5–12.5pt
- 中文行高 1.6–1.75；标题行高 1.05

## 布局

- 手机内容最大宽度 720–760pt，桌面上居中。
- 页面左右 padding 16–22pt；卡片内 16–24pt。
- 圆角：卡片 26–32，输入/按钮 16–18，胶囊 999。
- 底部浮动 Tab Bar 高出安全区 10pt，高 66pt。
- 对话页隐藏 Tab Bar，输入条固定在安全区上方。
- 所有滚动容器使用 <code>dvh</code> 和 safe-area，键盘使用 <code>interactive-widget=resizes-content</code>。

## 动效

- 进入：<code>fade-up</code> 450–550ms，cubic-bezier(.16,1,.3,1)
- 按压：scale 0.94–0.98，spring response 0.25–0.3
- Tab 指示器：translateX 450ms spring
- 运行指示：呼吸光球 + 三点波
- 扫描线：2.2s 上下往复
- <code>prefers-reduced-motion</code> 下全部降级为瞬时

## 组件

### Web

- 玻璃卡片、玻璃胶囊、主按钮、幽灵按钮、危险按钮
- 搜索胶囊、过滤 chip、统计条
- 会话卡片、消息气泡、Markdown、代码块、工具卡片
- 浮动 Tab Bar、底部 Sheet、Toast、FAB（已移至头部）
- 启动屏、错误屏、Web 配对屏

### SwiftUI

- DshLogo、GlassCard、PrimaryButtonStyle、GlassButtonStyle、RoundIconButtonStyle
- StatusPill、IconBadge、InfoLine、SheetGrabber
- AuroraBackground、BootLogo
- ScannerView 的取景框、遮罩、扫描线、手电筒
- PairingFlowView 的 6 位核对码、成功态
- NativeShellSettings

## 无障碍

- 所有按钮有 accessibility label（Web 使用 <code>aria-label</code>，SwiftUI 使用系统 Label）。
- 对比度：主文字在玻璃上保持 ≥ 4.5:1；次要文字不承载关键操作。
- 点击目标 ≥ 44pt（Web 的 icon-btn 42 + padding）。
- 支持 Dynamic Type：SwiftUI 使用系统字体；Web 使用相对字号和 <code>text-size-adjust</code>。
- 不依赖颜色单独传达状态：运行中同时有文字/旋转图标。
- 支持深浅色和减少动态效果。
- 扫码页始终显示“只在本机局域网内配对”的提示。

## 截图

<code>pnpm screenshots</code> 使用 Playwright + Chrome，在 393×852、3x 下生成：

- 01-home-dark / 05-home-light
- 02-chat-dark / 06-chat-light
- 03-activity-dark
- 04-settings-dark
- 07-web-pairing
- 08-desktop-pairing

CI 的 iOS job 还会生成 <code>ios-onboarding.png</code>，用于确认原生壳在模拟器中能启动。

## 设计取舍

- 不用第三方 UI 框架，避免设计系统被组件库绑死。
- 不在手机上渲染桌面 DSH 的完整 UI；只保留“会话、对话、活动、设置”四个核心面。
- 工具调用用可折叠卡片，而不是把命令输出全部铺开。
- 最终回答才渲染 Markdown；工具参数和输出保持等宽纯文本。
- 运行中明确显示“当前工具”，因为 SDK 不提供逐 token 流。
