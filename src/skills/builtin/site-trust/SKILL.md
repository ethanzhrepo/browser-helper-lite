---
name: site-trust
description: Judges whether an unfamiliar web shop, seller or site can be trusted before the user pays or signs up, from its address, its own pages and what others report about it. Use when the user asks whether a store, seller or site is legitimate, safe or a scam.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Judge a site the user does not know, and say how sure you are. Only read: do not sign up, add to a cart or open a checkout to find out.

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 2, what the site itself shows
- The address: does the domain imitate a known brand (extra words, swapped or doubled letters, an ending like .shop or .top for a famous name)? Is the page the user is on the site the link claimed to be?
- Its own pages: read its about or imprint, contact, shipping, returns and terms pages, together with research_pages. Warning signs: no company name or registered address, an address that is a home or does not exist, contact only by a web form or a messenger app, returns only abroad at the buyer's cost, text copied from other shops, prices far below every other store, a countdown on every product, and reviews only on the site itself.
- Payment: only bank transfer, crypto, gift cards or payment to a person is a strong warning; cards and payment services with buyer protection are better. Use what the page already says about payment; do not go to the checkout to see.
- On a marketplace (Amazon, eBay, Taobao, Shopee and the like), judge the seller, not the marketplace: its rating and how many ratings, how long it has sold, where it ships from, and who handles returns.
- Report: what you found on the site, the warning signs first.

Stage 2 of 2, what others say, and the verdict (your final message)
- web_search the domain and the company name with "scam", "review", "fraud" and the words in the user's language (骗子, 投诉, Betrug, arnaque, estafa…), and the national consumer-complaint or scam-warning sites. Read what you find with research_pages. Few results for a site that claims to be big is itself a sign.
- Give a verdict (looks legitimate, be careful, or likely a scam), then the reasons from weightiest to least, each with where you saw it, and what the user can do to be safe (pay by card, check the company register, buy from a known store). Say plainly what you could not check: how old the domain is and company records are often not readable from here.
