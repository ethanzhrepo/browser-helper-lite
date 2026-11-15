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
1. Know the exact product: brand, model and variant (size, color, capacity). If the current tab is its product page, read it: the product data has the name, the price and the SKU.
2. Find the same model at other stores: web_search with the model name or SKU, then read the offers together with research_pages. Leave out look-alikes and other variants, and say so when you are not sure two listings are the same thing.
3. For each offer work out the delivered price: the price of that variant, plus shipping, taxes and fees, minus coupons that apply (read their terms: minimum order, one per order). Work it out from the page's terms. Do not add to a cart or open a checkout to see a total: that changes the user's cart.
4. Note who sells it (the store itself or a marketplace seller), whether it is in stock and when it would arrive, the return window and the warranty. An offer that cannot be delivered soon is not the cheapest.
5. Answer with the best offer and why, in a sentence or two; then the offers.

Presenting products
- Show each product or offer as a short block: its picture, then the name, what the user would pay, the store, whether it is in stock, and a link to the page.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address. For several offers, add a comparison table after the blocks.
