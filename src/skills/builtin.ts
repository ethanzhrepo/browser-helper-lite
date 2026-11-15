import type { Skill } from './skills';

/**
 * How products are shown, shared by the shopping skills. Pictures are shown
 * only when their address was on a page the assistant read (see pictures.ts),
 * so the skill says where the address must come from.
 */
const PRESENTING = `Presenting products
- Show each product or offer as a short block: its picture, then the name, what the user would pay, the store, whether it is in stock, and a link to the page.
- Write a picture as ![name](address). Use only picture addresses that appeared on a page you read (in the product data, or as an image in the page text). Never make one up or change one; leave the picture out when you have none. Pass the address on as it is: do not open the picture or look at it first, the user sees it in the reply.
- Link every product and every source with its real address. For several offers, add a comparison table after the blocks.`;

/** The skills that come with the extension. Their names are used by the slash commands (see commands.ts). */
export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'compare-prices',
    description: 'Use when the user asks to compare prices across stores, or where to buy a product cheapest: compares stores by what they would pay delivered. Not for working out the price on the page they are on.',
    builtin: true,
    instructions: `Compare what the user would pay in the end, not list prices.
1. Know the exact product: brand, model and variant (size, color, capacity). If the current tab is its product page, read it: the product data has the name, the price and the SKU.
2. Find the same model at other stores: web_search with the model name or SKU, then read the offers together with research_pages. Leave out look-alikes and other variants, and say so when you are not sure two listings are the same thing.
3. For each offer work out the delivered price: the price of that variant, plus shipping, taxes and fees, minus coupons that apply (read their terms: minimum order, one per order). Work it out from the page's terms. Do not add to a cart or open a checkout to see a total: that changes the user's cart.
4. Note who sells it (the store itself or a marketplace seller), whether it is in stock and when it would arrive, the return window and the warranty. An offer that cannot be delivered soon is not the cheapest.
5. Answer with the best offer and why, in a sentence or two; then the offers.

${PRESENTING}`,
  },
  {
    name: 'review-analysis',
    description: 'Use when the user asks what buyers say about a product, or for a summary of its reviews: reads beyond the first page and finds the problems that recur.',
    builtin: true,
    instructions: `Sum up what buyers say, beyond the first page.
1. Find the reviews: the product page links to them. Note the rating, the number of reviews and the split by stars.
2. Read more than the first page: the most recent and the lowest-rated reviews, where the site lets you sort or filter. Pass the addresses of those pages to research_pages instead of clicking through them.
3. Report the rating and the count; what people praise; and the problems that several reviewers describe, each with a short quote and how often it comes up. Say when a problem shows only after weeks or months of use.
4. Say so when reviews look fake: many alike on the same days, very short five-star ones, reviews about another product, a rating that does not fit the text.
5. Keep to what the reviews say. Three complaints are three complaints, not "many users".
6. End with links to the review pages you read.`,
  },
  {
    name: 'reputation',
    description: 'Use when the user asks whether a product is any good, what people say about it online, or for tests and opinions beyond the store: looks at reviewers, forums and social media.',
    builtin: true,
    instructions: `Find out what is said about a product away from the store: tests by reviewers, and owners on forums and social media.
1. Search the web for the exact model with words like "review", "problems", "long-term" and "vs", and their equivalents in the user's language (评测, 口碑, 翻车, 缺点). Use site: to look where owners talk: reddit.com and youtube.com; for products sold in China also zhihu.com, xiaohongshu.com, bilibili.com and smzdm.com.
2. Read what the search finds. Tests and articles can be read together with research_pages. Forums and social media are opened in the tab (navigate or open_tab): they show more to someone who is signed in, and you are browsing for the user, with their account, at a person's pace. Look at a handful of threads or posts on a site, enough to see a pattern. Do not page through everything.
3. Only read. Do not like, follow, comment, vote or send messages. When a site asks to sign in or shows a CAPTCHA, hand_off to the user and go on when they are done. If they would rather not, use what the search results show and say that the site could not be read.
4. Report in two parts: what testers found (with their measurements, when they give any), and what owners report after living with it (recurring praise and complaints, each with a short quote and a link). Give dates: an old complaint may be about an earlier revision.
5. Tell paid from unpaid: sponsored videos, "best of" lists with affiliate links and posts by the store count for less. Say how much you found; a few posts are a few posts.`,
  },
  {
    name: 'buying-checks',
    description: 'Use before a purchase, when the user asks what to watch out for or whether a store or an offer can be trusted: finds what could cost them later.',
    builtin: true,
    instructions: `Before the user pays: find what could cost them later, and report only what matters.
- Who sells and ships it: the store, the maker or a marketplace seller; from where, and how long delivery takes.
- Returns: how many days, who pays for sending it back, restocking fees. Warranty: how long, and who honors it.
- Costs beyond the price: shipping, taxes and duties, accessories it needs, subscriptions or trials that renew (look for boxes that are ticked already).
- Whether it is the right thing: region, plug, voltage, size, compatibility, and the variant that is actually selected.
- What goes wrong according to the low-rated reviews.
- Pressure: countdowns, "only 2 left", "was" prices. They are the shop's claims, not facts.
List the points from most to least serious, each with where the page says it. Say so plainly when you find nothing wrong.`,
  },
  {
    name: 'deal-check',
    description: 'Use when the user asks whether a price or a discount is good, or whether to buy now or wait: checks the price over time and at other stores.',
    builtin: true,
    instructions: `Is the price a good one, and is the discount real?
1. Look for the price over time: a price history on the page, or a web_search for the model with "price history". Compare with what other stores charge now (research_pages on their pages).
2. A "was" price that has not been charged for months is not a saving. Say what the product has really cost lately.
3. Compare with similar products of the same class when that helps to judge the price.
4. Answer plainly: buy now, wait, or skip, with the reason in a sentence or two. Then the evidence, with links.

${PRESENTING}`,
  },
];
