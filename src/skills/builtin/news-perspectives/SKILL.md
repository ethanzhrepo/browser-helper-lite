---
name: news-perspectives
description: Compares how several outlets report the same news story, what they agree on, where they differ, and what each leaves out. Use when the user asks for other views on a story, whether coverage is biased, or what different sources say about an event.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 2, the story and who covers it
- Pin the story down: the event, the date, and the facts in dispute. Start from the article the user is on, if any.
- Find coverage from outlets of different leanings, and from different countries when that matters, plus news agencies and primary sources (official statements, documents, data). web_search the key names with the date.
- Report: the story in two or three sentences, and the outlets you will compare.

Stage 2 of 2, the comparison (your final message)
- Read the reports together with research_pages. Compare: the facts all agree on; where they differ (figures, the order of events, who is quoted); the framing (the headline's wording, what comes first, whose voices are left out); and what has changed since the first reports.
- Answer with what is established, then a table: outlet, how it frames the story, what it stresses or leaves out, link and time. Describe framing neutrally and let the user judge.
- Say how fresh the information is, and when the story is still developing.
