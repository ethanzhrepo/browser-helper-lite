# Browser Helper Lite

English | [简体中文](README.zh-CN.md)

An AI assistant in Chrome's side panel that works with the model and API key of your choice. It answers questions about the page you are on and, on sites you allow, clicks, types and navigates for you, asking first before anything risky.

![The assistant has found a cable and added it to the cart, and asks before placing the order](docs/images/agent.png)

## Features

- **Any model, your own key**: OpenAI, Anthropic, Google Gemini, DeepSeek, and any OpenAI-compatible API (Qwen, Kimi, GLM, Doubao, OpenRouter, Groq, Ollama, LM Studio and more).
- **Chat about pages**: summaries and comparisons of the page you are on, other tabs with `@`, Markdown with code, math and Mermaid diagrams, and voice input.
- **Acts on websites**: searches, clicks, types, scrolls and opens tabs to finish a task, and hands CAPTCHAs and logins back to you.
- **You stay in control**: three modes, Query (read only), Auto (asks before payments, deletions and other high-risk steps) and Manual approval (asks before every change), plus per-site rules. Pause, stop or take over at any time.
- **Defends against prompt injection**: hidden page text never reaches the model, page content cannot pass as instructions, and links that would carry your data out need your approval. See [docs/security](docs/security/README.md).
- **No server of its own**: conversations stay in your browser, and requests go straight to the provider you configure.

The interface is available in English, 简体中文, Français and Español.

| Ask about the page you are reading | Connect the providers you use |
| --- | --- |
| ![Comparing the machines in a buying guide](docs/images/chat.png) | ![Model providers in Settings](docs/images/settings.png) |

## Install

Requires Chrome 116 or later.

1. Download `browser-helper-lite-<version>-chrome.zip` from [Releases](https://github.com/ethanzhrepo/browser-helper-lite/releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Click the toolbar icon to open the side panel, then add a model connection in Settings.

While the assistant acts on a page, Chrome shows a "started debugging this browser" bar: the extension uses Chrome's debugger API to send real mouse and keyboard input. To build without the `debugger` permission, run `pnpm build:no-cdp`; the assistant then simulates page events instead.

## Development

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm dev           # opens Chrome with the extension loaded
pnpm build         # builds into .output/chrome-mv3
pnpm zip           # packs the release zip
pnpm compile       # type check
pnpm test          # unit tests
pnpm test:e2e      # end-to-end tests in Chromium against a mock model server
pnpm screenshots   # regenerates the screenshots in this README
```

Before the first end-to-end run, install Playwright's browser with `pnpm exec playwright install chromium`, or point `CHROMIUM_PATH` at Chromium 141 or later.

The design notes ([docs/product-design.md](docs/product-design.md)) and security records are in Chinese.

## Privacy

Conversations are stored locally in the browser. Requests go directly from the extension to your model provider. API keys stay in the extension's storage and are never exposed to web pages. Requests to OpenAI set `store: false`.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
