---
name: terms-review
description: Reads terms of service, privacy policies, subscription terms, warranties and contracts, and points out what could bind or cost the user, quoting the text. Use when the user asks what they are agreeing to, what the catch is, or to check terms, a policy or a contract.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its read_page, read_url and research_pages tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Read the terms the user is about to accept and report what matters to them, with the text that says it.

1. Read the whole document with read_page. When the terms are split over linked pages (privacy policy, cookie policy, subscription or refund terms), read those too, with research_pages. Note the date or version of the terms.
2. Look for:
   - Money: automatic renewal and how long before it you must cancel, price changes, a trial that turns paid, cancellation fees, minimum terms, refunds.
   - Leaving: how to cancel (only by phone, letter or in person?), and what happens to the user's data and content after.
   - Data: what is collected, who it is shared with or sold to, whether it is used to train AI, how long it is kept, and how to opt out.
   - Rights: licences the user grants on their content, arbitration and class-action waivers, which court and law apply, limits on liability, and the right to change the terms without notice.
   - Anything unusual for this kind of service.
3. Report the points that matter, most serious first. For each: one plain sentence, a short quote, and where it is (the section heading). Then what the user can do: opt out, set a reminder before the renewal, choose another plan.
4. Explain the text; do not give legal advice. A clause may not hold where the user lives: say so only as a possibility, and suggest a professional for decisions that matter.
5. When the terms are ordinary, say so in a sentence or two.
