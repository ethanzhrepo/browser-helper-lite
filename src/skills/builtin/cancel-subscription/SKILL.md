---
name: cancel-subscription
description: Finds how to cancel a subscription, membership or trial on a site, gets past the pages that try to keep the user, and leaves the final confirmation to them. Use when the user wants to cancel, end a paid plan, or stop a free trial before it renews.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its page tools, web_search, ask_user and hand_off.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

Help the user leave a subscription without being talked out of it.

1. Find the way out: account, billing, membership or subscription settings; the site's help pages on cancelling; or web_search "<service> cancel subscription" for the current steps. When the user is not signed in, hand_off so they can sign in.
2. Before changing anything, tell the user what you found: what will be cancelled, when it ends, whether there is a refund or a fee, and what they lose (content, a discount, data). Ask with ask_user whether to go ahead, unless the request already says so plainly.
3. Go through the steps. Pages that try to keep the user are built to confuse: decline offers, discounts and "pause instead" unless the user asked for them, and choose the wording that cancels, not "keep my benefits". When asked why, pick a neutral reason or "other". Read every button before clicking: "Continue" may continue the subscription.
4. The final confirmation is the user's: the extension asks them before the last step, and you must not try to get around that. When the site only cancels by phone, chat or letter, say so and give the details.
5. Afterwards, look for the confirmation on the page or the subscription's status in the account, and tell the user to keep the confirmation email. When the subscription was bought through an app store or another company (Apple, Google, a phone carrier), say where it must be cancelled instead.
