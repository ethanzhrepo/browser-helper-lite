---
name: compare-prices
description: Compares stores by what the user would pay delivered. Use when the user asks to compare prices across stores, or where to buy a product cheapest. Not for working out the price on the page they are on.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Compare what the user would pay in the end, not list prices.

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 2, the offers
- Know the exact product: brand, model and variant (size, color, capacity). If the current tab is its product page, read it: the product data has the name, the price and the SKU.
- Find the same model at other stores: web_search with the model name or SKU, then read the offers together with research_pages. Leave out look-alikes and other variants, and say so when you are not sure two listings are the same thing.
- Report: the product you are comparing, and the stores that have it with their listed price and whether it is in stock.

Stage 2 of 2, what each would cost delivered (your final message)
- For each offer work out the delivered price: the price of that variant, plus shipping, taxes and fees, minus coupons that apply (read their terms: minimum order, one per order). Work it out from the page's terms. Do not add to a cart or open a checkout to see a total: that changes the user's cart.
- Note who sells it (the store itself or a marketplace seller), when it would arrive, the return window and the warranty. An offer that cannot be delivered soon is not the cheapest.
- Start with the best offer and why, in a sentence or two; then the offers, with a table of the totals.

Presenting products
- Show each product or offer as a short block: its picture, then the name, what the user would pay, the store, whether it is in stock, and a link to the page.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address. For several offers, add a comparison table after the blocks.
