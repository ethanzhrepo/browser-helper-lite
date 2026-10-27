# 安全政策 / Security Policy

这个扩展可以读网页、在你授权的网站上替你操作，并且保存着你的 API Key，所以我们很重视安全问题。

## 报告漏洞

**请不要在公开的 Issue、讨论区或 Pull Request 里报告安全漏洞。**

请通过 GitHub 的私密漏洞报告提交：仓库的 **Security** 页 → **Report a vulnerability**，或者直接打开
<https://github.com/ethanzhrepo/browser-helper-lite/security/advisories/new>。

报告里最好包括：

- 受影响的版本或提交
- 复现步骤（能附上触发问题的网页最好）
- 你认为的影响：谁能利用、能拿到什么、需要用户做什么

这是个人维护的项目，没有固定的响应时限，但会尽快确认和回复。修复发布之前，请不要公开细节。修复后会在 [docs/security/](docs/security/README.md) 里记录，并在你同意时致谢。

## 范围

下面这些属于安全问题：

- 网页、网页里的脚本或其他扩展拿到 API Key、对话记录或设置
- 网页让助手在没有你确认的情况下执行需要确认的操作（付款、删除、提交表单等），或者绕过模式和网站策略
- 网页内容让助手把你的数据发出去（网址、图片、搜索词、表单等），而没有经过确认
- 侧边栏或设置页加载了远程内容，或者绕过了扩展页面的 CSP
- 带 Key 的请求走了明文 HTTP（发往本机的除外）

下面这些通常不算，或者已经是已知限制：

- [docs/security/README.md](docs/security/README.md)「还没做到的，以及建议」里列出的限制，例如规则识别会漏、截图里的敏感信息过滤不掉。能明显绕过某一层防护的新方法仍然欢迎报告
- 需要先控制你的电脑、Chrome 配置或安装恶意扩展才能利用的问题
- 模型供应商或搜索服务自身的问题
- 自动模式按设计自动执行的 L1、L2 操作

## 支持的版本

只修复最新发布的版本。

---

## English

This extension reads web pages, acts on websites you allow, and stores your API keys, so we take security reports seriously.

**Please do not report vulnerabilities in public issues, discussions or pull requests.** Use GitHub's private vulnerability reporting instead: the repository's **Security** tab → **Report a vulnerability**, or <https://github.com/ethanzhrepo/browser-helper-lite/security/advisories/new>.

Please include the affected version or commit, steps to reproduce (ideally a page that triggers the issue), and the impact as you see it. This is a personally maintained project with no fixed response time, but reports are acknowledged as soon as possible. Please keep details private until a fix is released; fixes are recorded in [docs/security/](docs/security/README.md), with credit if you wish.

In scope: anything that lets a web page, a page script or another extension read API keys, conversations or settings; make the assistant perform an action that needs your approval without it, or bypass modes and site policies; send your data out (URLs, images, search queries, forms) without approval; make extension pages load remote content or bypass their CSP; or send a keyed request over plain HTTP to a non-local host.

Usually out of scope: the known limitations listed in [docs/security/README.md](docs/security/README.md) (new ways to clearly defeat one of the defenses are still welcome), issues that require control of your computer, Chrome profile or a malicious extension, problems in model or search providers themselves, and L1/L2 actions that Auto mode performs by design.

Only the latest release receives fixes.
