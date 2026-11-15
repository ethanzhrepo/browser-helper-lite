---
name: deal-check
description: Checks a price over time and at other stores, to tell whether a discount is real. Use when the user asks whether a price or a discount is good, or whether to buy now or wait.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Is the price a good one, and is the discount real?
1. Look for the price over time: a price history on the page, or a web_search for the model with "price history". Compare with what other stores charge now (research_pages on their pages).
2. A "was" price that has not been charged for months is not a saving. Say what the product has really cost lately.
3. Compare with similar products of the same class when that helps to judge the price.
4. Answer plainly: buy now, wait, or skip, with the reason in a sentence or two. Then the evidence, with links.

Presenting products
- Show each product or offer as a short block: its picture, then the name, what the user would pay, the store, whether it is in stock, and a link to the page.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address. For several offers, add a comparison table after the blocks.
