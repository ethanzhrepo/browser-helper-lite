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

1. Know the need. From the request and the conversation, settle what it is for, the budget, the must-haves and the deal-breakers, and the country or region (the prompt says where the user is, unless they said otherwise). When the budget or the main use is missing and would change the answer, ask once with ask_user and offer likely choices; otherwise state your assumptions and go on.
2. Learn the category before the models. Search, in the user's language, for a recent buying guide for their country: which specs matter for this need, which are marketing, the usual price bands, and what tends to fail.
3. Find the candidates sold there. Read references/sources-by-region.md with read_skill_file for the testers, review sites, shops and forums of the user's country. A model sold only abroad, or under another name, is a candidate only if the user is fine with importing; say so when a strong option is not sold locally.
4. Check three to six candidates in three kinds of sources:
   - Testers: measured results (noise, battery hours, suction, brightness…) and the date of the test. Read tests and articles together with research_pages.
   - Owners: the low-rated reviews at local shops, and forums and social media, for problems that show after months. Open forums and social media in the tab and only read there: a handful of posts per site, enough to see a pattern. When a site asks to sign in or shows a CAPTCHA, hand_off to the user.
   - Price: what it costs now at two or three local stores, and whether it is often cheaper on sale.
5. Search sparingly: one search for the guide, one for tests of the category, and at most one for each finalist; read what a search found before the next. What three searches did not find, a fourth seldom does.
6. Weigh, do not count. Sponsored videos, affiliate "best of" lists and posts by the brand count for less. Say when sources disagree, and when a complaint is about an older version of the model.
7. Answer:
   - The pick for their need, and one or two alternatives (cheaper, or better at one thing), each with why in a sentence or two.
   - A comparison table: model, price there, the specs that matter for this need, the main strength, the main complaint, and links.
   - Who should not buy the pick.
   - The sources you relied on, with links and dates.

Presenting products
- Show each recommended model as a short block: its picture, then the name, the price there, where to buy it, and a link.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address.
