---
name: data-extraction
description: Collects structured data from pages (lists of products, listings, results, tables) into one table that can be sorted and downloaded as CSV, across a few pages of results. Use when the user asks to collect, list, compile or export data from a page or a set of pages.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its read_page, extract and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

1. Agree on the columns: from the request, or propose them from what the page shows (name, price, rating, date, link…). Keep the units the page uses.
2. Take the data from the page's text, with read_page, or extract with a precise query on a long page. Copy values as they are written: do not round or convert unless asked. Keep each item's link.
3. More pages: follow "next" or the page numbers, up to five pages unless the user asks for more, and stop when items repeat. When each item has a page of its own, read those pages together with research_pages. On forums and social media, keep to the limits the extension sets.
4. Put everything in one Markdown table: the user can sort it and download it as CSV. Say how many items you collected from how many pages, and what you left out (items without a price, ads, duplicates).
5. Do not collect personal details about private people (names with contact details, profiles) beyond what the task needs.
