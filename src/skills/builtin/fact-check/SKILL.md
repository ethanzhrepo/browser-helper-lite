---
name: fact-check
description: Checks the claims in an article, post or message against original sources, and says which hold, which mislead and which are wrong. Use when the user asks whether something is true, to fact-check a page or a claim, or whether a story is real.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 2, the claims
- Pick the claims that matter: the checkable statements of fact the piece rests on (figures, quotes, dates, who did what). Leave opinions out. Check at most five unless the user asks for more.
- Report: the claims you will check, as a short numbered list.

Stage 2 of 2, the verdicts (your final message)
- For each claim, find where it comes from: the original study, data, document, statement or recording, not another article that repeats it. web_search the exact figure, quote or name, and read what you find with research_pages. Prefer primary sources, official data and established fact-checkers, including those in the user's language.
- Judge each claim: supported (a primary source says so); misleading (true but without context that changes it, outdated, or cherry-picked); unsupported (no source found); false (a reliable source contradicts it). Note each source's date: a claim may have been true once.
- Watch for pictures and quotes from another time or place, satire taken as news, figures without a base, and screenshots of posts that cannot be found.
- Answer with a table (claim, verdict, the evidence in a sentence, the source with its link), then one sentence on the piece as a whole. Say how sure you are. When a source could not be reached, say so instead of guessing.
