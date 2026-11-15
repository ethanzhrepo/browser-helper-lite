---
name: github-thread
description: Sums up a GitHub or GitLab issue, pull request or discussion - the problem, how to reproduce it, what was tried, the current state and the next step. Use when the user is on such a thread and asks what it is about, whether it is fixed, or what to do.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its read_page and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

1. Read the thread once with read_page, and sum up what it shows. A comment count higher than the comments you see is no reason to look further. Only when the page has a control for hidden comments ("Load more", "N hidden items") and the answer may be in them, press it once. Read a linked issue or pull request, with research_pages, only when the thread does not say what it did; do not open it in a tab.
2. Report:
   - The problem in a sentence or two, with the environment and versions involved.
   - How to reproduce it, when the thread says.
   - What was tried, and the workarounds people confirm work.
   - The state: open or closed; fixed (by which pull request, in which release), a duplicate, "won't fix", or stale; and who decided.
   - For a pull request: what it changes, the review comments that matter, whether the checks pass, and what blocks merging.
3. Quote short key comments with their author and date. Keep maintainers' statements apart from users' guesses.
4. Do not comment, react, subscribe or change anything on the thread unless the user asks.
