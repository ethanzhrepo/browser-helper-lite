---
name: docs-lookup
description: Finds the exact answer in technical documentation, for the version the user has, with a working example and a link to the source. Use when the user asks how to use a library, API, command or setting, or why something does not work as documented.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search, read_url and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

1. Know the version: from the user, the page they are on, or their code. When it matters and is unknown, say which version you answer for.
2. Go to the official documentation first: the project's documentation site, its API reference, and the repository's README and changelog. web_search the exact function, option or error message, and read pages with read_url or research_pages. The reference comes before blog posts; issue trackers and Q&A sites help for bugs and workarounds, with their dates.
3. Answer with the direct answer, a minimal example that matches the documented signature, and a link to the exact section. Note deprecations, differences between versions and common mistakes.
4. Do not invent options or parameters. When the documentation does not say, say so, and point to what it does say.
