---
name: reputation
description: Finds what reviewers, forums and social media say about a product, away from the store. Use when the user asks whether a product is any good, what people say about it online, or for tests and opinions beyond the store.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search, research_pages and hand_off tools, and opens forums in the user's tab.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Find out what is said about a product away from the store: tests by reviewers, and owners on forums and social media.

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 3, what testers found
- Start with two searches, in the user's language: the exact model with "review" (评测), and the exact model with "problems" (缺点, 翻车) or with site: for one place where owners talk (reddit.com, youtube.com; for products sold in China zhihu.com, xiaohongshu.com, bilibili.com, smzdm.com). Read what they find before you search again. Search again only for something specific that is still missing (a problem someone named, a site that did not come up), two more times at most: rephrasing a search finds little that the first ones did not.
- Read tests and articles together with research_pages.
- Report: what testers found, with their measurements when they give any, the dates, and links.

Stage 2 of 3, what owners say
- Forums and social media are opened in the tab (navigate or open_tab): they show more to someone who is signed in, and you are browsing for the user, with their account, at a person's pace. Look at a handful of threads or posts on a site, enough to see a pattern. Do not page through everything.
- Only read. Do not like, follow, comment, vote or send messages. When a site asks to sign in or shows a CAPTCHA, hand_off to the user and go on when they are done. If they would rather not, use what the search results show and say that the site could not be read.
- Report: what owners report after living with it, the recurring praise and complaints, each with a short quote and a link. Give dates: an old complaint may be about an earlier revision.

Stage 3 of 3, the verdict (your final message)
- Whether it is any good, for whom, and what to watch for, in a few sentences.
- Tell paid from unpaid: sponsored videos, "best of" lists with affiliate links and posts by the store count for less. Say how much you found; a few posts are a few posts.
