# dsh-element-source-plus

**一个插件，两件事：点元素取源码 + 内置浏览器的工具栏菜单。**

DSH 桌面端内置浏览器里的开发辅助插件。它是 [dsh-element-source](https://github.com/GULI-lab/DSH-element-source)（MIT）的衍生版：保留原作者的全部取源能力，并在同一个客户端里并入一个 `⋮` 菜单，取代需要另装第二个插件的做法。

## 能力一：点元素取源码（上游能力）

- 在 dev 页面悬停元素 → 右下角出现「添加到对话」气泡 → 点击
- 当前会话输入框收到文件引用 chip，例如 `LoginPage.tsx:90`；点 chip 在内置预览里跳到该行
- 插件**不会**替你发送消息
- 框架：React（精确）/ Vue 2·3 / Svelte / Angular / code-inspector / 通用文本搜索兜底

## 能力二：`⋮` 工具栏菜单（本衍生版新增）

```text
缩放          100%  ›   → 50 … 200 / 重置为 100%
视口          电脑  ›   → 电脑（占满）/ 平板 768px / 手机 390px
在系统浏览器中打开       → 收编 DSH 自带的 ↗，原按钮隐藏
打开开发者工具
控制台报错       3   ›   → [error]/[warn] 明细 + 清空（仅有条目时出现）
──────────────────
项目主页 · GitHub
```

- 缩放走 `<webview>.setZoomFactor()`，Chromium 原生缩放，**不是** CSS `zoom`
- 视口是收窄 `<webview>` 并居中，用来快速看窄屏布局，**不是真机模拟**
- 报错监听 `console-message` / `did-fail-load` / `crashed`，导航后自动清零，有报错时 ⋮ 变红

## 快捷拾取（v1.1.0 新增）

拾取不需要每次都去点那个气泡了。打开任意内置浏览器标签，点工具栏最右的 `⋮` → **快捷拾取**，选一种：

| 选项 | 怎么用 |
| --- | --- |
| 只点气泡 | 默认行为，点元素右下角的「添加到对话」气泡 |
| **Enter 键** | 悬停到目标元素上，直接按回车 |
| **空格键** | 悬停后按空格 |
| **Alt + 单击** | 按住 Alt 点元素本体（不用瞄准气泡） |
| **双击元素** | 直接双击目标 |
| **自定义按键…** | 选它之后按下任意键（可带 Ctrl / Alt / Shift / Meta）即生效；Esc 取消 |

当前选项会显示在「快捷拾取」这一行右侧，气泡上也会提示对应按键（例如「添加到对话 · Enter」）。

设置存在 DSH 客户端本地（`localStorage`），按浏览器标签各自生效但共用同一份配置；切换标签、刷新页面、重启应用都会保留。

> 拾取模式下页面点击本来就被拦截，所以这些快捷键不会误触发页面自己的行为。

## 安装

```sh
cd ~/.dsh/profiles/desktop
npx -y --package @deepseek-ai/dsh dsh plugin --profile desktop add dsh-element-source-plus
```

本地源码：

```sh
git clone https://github.com/NewbieCheng/dsh-element-source-plus
cd ~/.dsh/profiles/desktop
npx -y --package @deepseek-ai/dsh dsh plugin --profile desktop add link:/absolute/path/to/dsh-element-source-plus
```

装完重启 DSH 桌面端。**不要再装 `dsh-element-source`**：两者功能重叠，同时安装会在同一行工具栏上各插一个按钮。

## 自检

```sh
curl http://127.0.0.1:<host-port>/dsh-element-source-plus/api/status
```

```json
{"ok":true,"value":{"mountedAt":1794108479347,"beats":8,"version":"1.0.0","bars":1,"labels":["后退","前进","刷新","在系统浏览器中打开"],"external":true}}
```

`mountedAt` 为 0 表示客户端没加载；`bars` 是装饰到的工具栏数；`external` 表示「在系统浏览器中打开」是否被识别并收编。

## 已知限制

- 依赖 DSH 内置浏览器的工具栏 DOM（靠地址栏输入框的祖父元素定位）。DSH 前端重构可能失效。
- 视口预设是宽度约束，不是设备模拟（无 UA/DPR/触摸伪装）。
- 仅桌面端；纯网页 `dsh web` 没有 `<webview>`。

## 与上游的关系

`lib/client.js`、`lib/index.js`、`lib/inject.js` 来自 [dsh-element-source](https://github.com/GULI-lab/DSH-element-source) 0.2.1（MIT），在其基础上：
1. 客户端追加 `installToolbar()`（IIFE 包裹，避免与上游的 `toolbarOf` 等同名符号冲突）；
2. 宿主追加 `/dsh-element-source-plus/api/{ping,status}` 探针路由；
3. 模块 id 与 bundle 行改为 `dsh-element-source-plus`。

上游版权与许可见 [LICENSE](LICENSE)。

## License

[MIT](LICENSE)