---
name: travel-compare
description: Compares flights, hotels, rentals and tickets by the total the user would pay and the conditions that matter (bags, fees, cancellation, location), and stops before booking. Use when the user asks for the cheapest or best flight, hotel, rental or ticket, or to compare travel offers.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its web_search, research_pages and ask_user tools.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Work out what the trip would really cost and what the user gets, then leave the booking to them.

Work in stages. At the end of each stage but the last, call report_progress with that stage's result (its name, its number and how many stages there are), written as it should stay in the answer; send it together with the first tool calls of the next stage, and go on without waiting. The user sees each part as it comes and may add something: take it into account. The last stage is your final message, which follows what you reported and does not repeat it.

Stage 1 of 2, the offers
- Settle the trip: from and to, the dates and how flexible they are, how many travel, the bags, and for a stay the area and the must-haves. Ask once with ask_user when a missing detail would change the answer.
- Look where people book that trip: the airline's or hotel's own site, and one or two comparison sites common in the user's country or that the user named. Filling in a search form only searches and is fine. Do not sign in, choose seats, add extras or go on to payment.
- Report: the trip as you understood it, and the offers found with their headline price.

Stage 2 of 2, the totals (your final message)
- For each offer, work out the total: the fare or room rate, taxes, booking and service fees, the checked bags and seats the user needs, resort or city taxes, card fees and currency conversion. Take the figures from the offer's details or fare rules, not the headline price.
- Note the conditions: changes and cancellation (free until when, refund or voucher), the baggage allowance, stops and how long they are, the airport or neighbourhood, check-in times, and for a stay the rating in recent reviews and where it really is.
- Start with the best value and the cheapest, when they differ, and why. Then a table: offer, total, what it includes, conditions, link. Prices change quickly: say when you saw them. Stop at the booking step and tell the user how to book.
