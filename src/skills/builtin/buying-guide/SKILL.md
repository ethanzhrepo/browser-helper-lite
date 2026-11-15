---
name: buying-guide
description: Helps the user choose which brand and model to buy where they live, from tests, owner reviews and social media, and recommends a few for their needs and budget. Use when the user knows what they need but not which product, or asks what to buy or which model to choose.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search, research_pages, read_skill_file and ask_user tools, and opens forums in the user's tab.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Help the user go from "I need a quiet robot vacuum for a small flat" to two or three models they can buy where they live.

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 4, the need and what matters
- From the request and the conversation, settle what it is for, the budget, the must-haves and the deal-breakers, and the country or region (the prompt says where the user is, unless they said otherwise). When the budget or the main use is missing and would change the answer, ask once with ask_user and offer likely choices; otherwise state your assumptions and go on.
- Learn the category before the models: search, in the user's language, for a recent buying guide for their country, and read references/sources-by-region.md with read_skill_file for the testers, review sites, shops and forums there.
- Report: the need as you understood it, in a sentence or two, with your assumptions; then which specs matter for this need, which are marketing, and the usual price bands.

Stage 2 of 4, the candidates
- Find three to six models sold in the user's country that fit. A model sold only abroad, or under another name, is a candidate only if the user is fine with importing; say so when a strong option is not sold locally.
- Report: a table of the candidates with the price there and one line on each.

Stage 3 of 4, checking them
- Testers: measured results (noise, battery hours, suction, brightness…) and the date of the test. Read tests and articles together with research_pages.
- Owners: the low-rated reviews at local shops, and forums and social media, for problems that show after months. Open forums and social media in the tab and only read there: a handful of posts per site, enough to see a pattern. When a site asks to sign in or shows a CAPTCHA, hand_off to the user.
- Price: what it costs now at two or three local stores, and whether it is often cheaper on sale.
- Weigh, do not count. Sponsored videos, affiliate "best of" lists and posts by the brand count for less. Say when sources disagree, and when a complaint is about an older version of the model.
- Report: for each candidate, what testers measured, what owners complain about, and the price now, with links.

Stage 4 of 4, the answer (your final message)
- The pick for their need, and one or two alternatives (cheaper, or better at one thing), each with why in a sentence or two.
- A comparison table: model, price there, the specs that matter for this need, the main strength, the main complaint, and links.
- Who should not buy the pick.
- The sources you relied on, with links and dates.

Search sparingly: one search for the guide, one for tests of the category, and at most one for each finalist; read what a search found before the next. What three searches did not find, a fourth seldom does.

Presenting products
- Show each recommended model as a short block: its picture, then the name, the price there, where to buy it, and a link.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address.
