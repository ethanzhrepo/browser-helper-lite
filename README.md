# Browser Helper Lite

一个自带 Key（BYOK）、模型厂商中立、本地优先的 Chrome 侧边栏 AI 助手：
既能对话、读网页，也将在你授权的网站上替你点击、输入、滚动、导航。

- 产品构思与技术方案：[docs/product-design.md](docs/product-design.md)

## 当前进度：M0 地基

- 侧边栏聊天：流式回复、Markdown（含表格）、思考过程折叠、复制、重试、停止
- 页面上下文：附带当前页面（Readability 提取正文转 Markdown）、`@` 附带页面或选中文字、`/` 指令（总结、翻译、解释、提取表格）
- 模型供应商：OpenAI、Anthropic、Google Gemini、DeepSeek，以及 OpenAI 兼容接口（预设通义千问、Kimi、智谱、豆包、OpenRouter、硅基流动、xAI、Mistral、Groq、Ollama、LM Studio，或自定义地址）
- 能力分配：对话、快速、Agent、视觉四个槽位（Agent 和视觉从 M1 开始使用）
- 网站权限：安装时不申请任何网站；第一次读取某个网站或连接某个 API 地址时再请求授权
- 历史记录：保存在本地 IndexedDB，按「方便同步」的方式设计（ULID、消息只追加、删除用墓碑）
- 界面四种语言：简体中文、English、Français、Español，可在设置里即时切换

## 开发

需要 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm dev          # 启动开发模式，自动打开一个加载了扩展的 Chrome
pnpm build        # 生产构建，输出到 .output/chrome-mv3
pnpm zip          # 打包成 zip
```

手动加载：打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择 `.output/chrome-mv3`。
点工具栏上的扩展图标即可打开侧边栏，首次使用先在设置里添加一个模型连接。

### 构建开关

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `ENABLE_CDP_DRIVER` | `true` | 为 `false` 时 manifest 不声明 `debugger` 权限（`pnpm build:no-cdp`），供将来上架评估使用 |
| `E2E_GRANT_ALL_HOSTS` | 未设置 | 仅用于端到端测试：安装时授予所有网站权限，避免 Playwright 无法点击的权限弹窗。正式构建不要设置 |

### 测试

```bash
pnpm compile      # TypeScript 类型检查
pnpm test         # 单元测试（Vitest）
pnpm test:e2e     # 端到端测试：构建测试版扩展，用 Playwright 在 Chromium 里跑完整流程
```

端到端测试会启动一个本地的模拟 OpenAI 兼容服务器，覆盖：添加连接（含错误 Key）、自动分配对话模型、附带页面并流式回复、`/` 指令菜单、`@` 附带选中文字、历史记录、语言即时切换。
Chromium 路径可以用 `CHROMIUM_PATH` 指定；设置 `E2E_SCREENSHOT_DIR` 会保存界面截图。

## 目录结构

```
entrypoints/
  background.ts        Service Worker：聊天流式服务、连接测试
  sidepanel/           侧边栏界面
  options/             设置页
  extract-page.ts      按需注入的页面正文提取脚本
src/
  background/          后台服务实现
  browser/             页面内容与选中文字的读取
  chat/                提示词、指令、聊天会话
  i18n/  locales/      多语言
  permissions/         网站权限
  providers/           各厂商适配、模型列表、错误归类
  shared/              类型与消息协议
  storage/             设置、Key、IndexedDB
  ui/                  共享界面组件
tests/unit/            单元测试
tests/e2e/             端到端测试
```

## 隐私

没有自有服务器。对话保存在浏览器本地；请求直接从扩展发往你配置的模型供应商；API Key 只保存在扩展存储里，不会发送给任何网页。
连接 OpenAI 时设置了 `store: false`，不让 OpenAI 在服务端保留回复内容。
