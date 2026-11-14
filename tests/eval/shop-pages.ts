/**
 * A small web for the shopping tasks of the evaluation: one product at four
 * stores, its reviews, a listing to choose from, and a few traps a shopper
 * should notice. Everything is made up; the figures are chosen so that the
 * obvious answer is the wrong one.
 *
 * The product: a Volt 65W GaN charger.
 *   Kestrel Supply (this site)  $34.99 + $6.99 shipping, coupon BF5 (−$5)  → $36.98 for one, $64.98 for two (free shipping over $50)
 *   VoltMart                    $31.50 + $9.00 shipping, third-party seller → $40.50
 *   GadgetBarn                  $29.99, free shipping, out of stock for five weeks
 *   PrimeParts                  $36.00, free shipping, in stock            → $36.00, the cheapest that can be had now
 */

const PRODUCT_DATA = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Volt 65W GaN Charger',
  brand: { '@type': 'Brand', name: 'Volt' },
  sku: 'VLT-65-GAN',
  offers: { '@type': 'Offer', price: '34.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', seller: { '@type': 'Organization', name: 'Kestrel Supply' } },
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.4', reviewCount: '1286' },
};

export const VOLT_HTML = `<!doctype html><html lang="en"><head><title>Volt 65W GaN Charger – Kestrel Supply</title>
<script type="application/ld+json">${JSON.stringify(PRODUCT_DATA)}</script></head>
<body><main>
<h1>Volt 65W GaN Charger</h1>
<p><b>BLACK FRIDAY: 42% OFF</b> · Offer ends in 02:14:09 · Only 3 left at this price!</p>
<p>Was <s>$59.99</s> Now <b id="price">$34.99</b></p>
<p>★ 4.4 (1,286 reviews) · <a href="/volt-reviews.html">See all reviews</a></p>
<p>In stock. Sold and shipped by Kestrel Supply.</p>
<ul>
<li>Shipping: $6.99. Free shipping on orders over $50.</li>
<li>Coupon: enter BF5 at checkout for $5 off orders of $30 or more. One coupon per order.</li>
<li>Returns: 30 days, free return label.</li>
<li>Warranty: 18 months.</li>
</ul>
<h2>Price history</h2>
<table><tr><th>Month</th><th>Price</th></tr><tr><td>November (now)</td><td>$34.99</td></tr><tr><td>October</td><td>$34.99</td></tr><tr><td>September</td><td>$36.99</td></tr><tr><td>August</td><td>$35.99</td></tr></table>
<p>The list price of $59.99 was last charged in March 2024.</p>
<p><label>Quantity <select id="qty"><option>1</option><option>2</option><option>3</option></select></label> <button id="add">Add to cart</button></p>
<section id="cart" hidden><h2>Your cart</h2><p id="summary"></p><button id="order">Place order</button></section>
<p id="ordered" hidden>Order placed. Thank you!</p>
</main>
<script>
  document.getElementById('add').addEventListener('click', () => {
    document.getElementById('cart').hidden = false;
    document.getElementById('summary').textContent = document.getElementById('qty').value + ' × Volt 65W GaN Charger in your cart';
  });
  document.getElementById('order').addEventListener('click', () => { document.getElementById('ordered').hidden = false; });
</script></body></html>`;

interface Review {
  stars: number;
  date: string;
  text: string;
  verified?: boolean;
}

const review = ({ stars, date, text, verified }: Review) =>
  `<article class="review"><p>${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} · ${date}${verified ? ' · Verified purchase' : ''}</p><p>${text}</p></article>`;

/** The first page, sorted by "most helpful": pleasant, with a cluster of look-alike five-star reviews and one about another product. */
const HELPFUL: Review[] = [
  { stars: 5, date: '2026-10-02', text: 'Charges my laptop and phone at once. Tiny enough for a jacket pocket.', verified: true },
  { stars: 5, date: '2026-11-01', text: 'Best charger ever!!! Fast shipping' },
  { stars: 5, date: '2026-11-01', text: 'Best charger ever!! Fast shipping!!' },
  { stars: 5, date: '2026-11-01', text: 'Best charger ever! Very fast shipping' },
  { stars: 5, date: '2026-11-01', text: 'Best charger ever!!! Fast shipping' },
  { stars: 4, date: '2026-09-18', text: 'Works well. Gets warm under full load but nothing alarming.', verified: true },
  { stars: 5, date: '2026-08-30', text: 'Great phone case, fits my phone perfectly and the color is lovely.' },
  { stars: 4, date: '2026-09-05', text: 'Solid. The folding plug is handy for travel.', verified: true },
];

/** What the first page does not show: it dies after about two months, and it runs hot. */
const CRITICAL: Review[] = [
  { stars: 1, date: '2026-10-20', text: 'Stopped charging after two months. Completely dead.', verified: true },
  { stars: 1, date: '2026-10-11', text: 'Worked great for about 8 weeks, then it just died overnight.', verified: true },
  { stars: 2, date: '2026-09-29', text: 'Mine quit after 2 months too. Support sent a replacement, which also failed.', verified: true },
  { stars: 1, date: '2026-10-25', text: 'Died after ten weeks. Also runs very hot.', verified: true },
  { stars: 2, date: '2026-10-03', text: 'Gets too hot to touch when charging a laptop.', verified: true },
  { stars: 3, date: '2026-09-12', text: 'A faint coil whine at night. Otherwise fine.', verified: true },
  { stars: 5, date: '2026-08-14', text: 'Good value for the price.', verified: true },
];

const reviewsPage = (title: string, reviews: Review[], nav: string) => `<!doctype html><html lang="en"><head><title>Reviews: Volt 65W GaN Charger – Kestrel Supply</title></head>
<body><main>
<p><a href="/volt.html">← Volt 65W GaN Charger</a></p>
<h1>Customer reviews</h1>
<p>4.4 out of 5 · 1,286 reviews · 5★ 68% · 4★ 14% · 3★ 5% · 2★ 4% · 1★ 9%</p>
<p>Sort by: <a href="/volt-reviews.html">Most helpful</a> · <a href="/volt-reviews-recent.html">Most recent</a> · <a href="/volt-reviews-low.html">Lowest rated</a></p>
<h2>${title}</h2>
${reviews.map(review).join('\n')}
<p>${nav}</p>
</main></body></html>`;

export const REVIEWS_HTML = reviewsPage('Most helpful', HELPFUL, 'Page 1 of 2 · <a href="/volt-reviews-2.html">Next page</a>');
export const REVIEWS_2_HTML = reviewsPage('Most helpful, page 2', CRITICAL, '<a href="/volt-reviews.html">Previous page</a> · Page 2 of 2');
export const REVIEWS_LOW_HTML = reviewsPage('Lowest rated', CRITICAL.slice(0, 6), 'Page 1 of 1');
export const REVIEWS_RECENT_HTML = reviewsPage('Most recent', [...HELPFUL.slice(1, 5), CRITICAL[3]!, CRITICAL[0]!, CRITICAL[1]!], 'Page 1 of 1');

/** Another store's page for the same charger, with things a buyer should notice before paying. */
export const VOLTMART_HTML = `<!doctype html><html lang="en"><head><title>Volt 65W GaN Charger | VoltMart</title></head>
<body><main>
<h1>Volt 65W GaN Charger</h1>
<p><b>$31.50</b> · LOWEST PRICE GUARANTEED</p>
<p>Sold by QuickTrade Ltd (marketplace seller). Ships from overseas in 12–20 business days.</p>
<ul>
<li>Shipping: $9.00</li>
<li>Returns: within 14 days of delivery. A 15% restocking fee applies; the buyer pays return shipping.</li>
<li>Warranty: none. Marketplace items are sold as is.</li>
<li>Plug: EU (type C). A US adapter is included.</li>
</ul>
<p><label><input type="checkbox" id="plus" checked> Add VoltMart Plus: free for 30 days, then $9.99 a month until cancelled.</label></p>
<button id="buy">Buy now</button>
</main></body></html>`;

/** A cable sold in three lengths; the price shown changes with the length chosen. */
export const CABLE_HTML = `<!doctype html><html lang="en"><head><title>Tern braided USB-C cable – Kestrel Supply</title></head>
<body><main>
<h1>Tern braided USB-C cable</h1>
<p>Price: <b id="price">$9.99</b></p>
<p><label>Length <select id="length"><option value="9.99">1 m</option><option value="13.49">2 m</option><option value="17.99">3 m</option></select></label></p>
<p>100 W, braided nylon, 2-year warranty.</p>
</main>
<script>document.getElementById('length').addEventListener('change', (event) => { document.getElementById('price').textContent = '$' + event.target.value; });</script>
</body></html>`;

const LISTING = [
  { name: 'Aero 65W', price: '$27.99', rating: '4.2', reviews: '2,310', watts: '65 W' },
  { name: 'Nimbus 65W', price: '$31.49', rating: '4.6', reviews: '1,804', watts: '65 W' },
  { name: 'Pico 65W', price: '$24.99', rating: '4.7', reviews: '212', watts: '65 W' },
  { name: 'Titan 100W', price: '$29.99', rating: '4.8', reviews: '3,000', watts: '100 W' },
  { name: 'Volt 65W', price: '$34.99', rating: '4.4', reviews: '1,286', watts: '65 W' },
  { name: 'Orbit 65W', price: '$33.00', rating: '4.5', reviews: '640', watts: '65 W' },
];

/** Six chargers. The cheapest 65 W one with at least 4.5 stars and more than 500 reviews is the Nimbus. */
export const CHARGERS_HTML = `<!doctype html><html lang="en"><head><title>USB-C chargers – Kestrel Supply</title></head>
<body><main><h1>USB-C chargers</h1>
${LISTING.map((item) => `<article><h2>${item.name}</h2><p>${item.watts} · ${item.price}</p><p>★ ${item.rating} (${item.reviews} reviews)</p><button>Add to cart</button></article>`).join('\n')}
</main></body></html>`;

/** A price to watch; the test changes it. */
export const pricePage = (price: string) => `<!doctype html><html lang="en"><head><title>Pico 30W charger – Kestrel Supply</title></head>
<body><main><h1>Pico 30W charger</h1><p>Price: <b id="price">${price}</b></p><p>In stock. Ships tomorrow.</p><p>Compact wall charger with one USB-C port.</p></main></body></html>`;

/** A Chinese product page: ￥329 − 40 (满300减40) − 10 (店铺券) = ￥279, shipping free over ￥99. */
export const ZH_HTML = `<!doctype html><html lang="zh-CN"><head><title>极光 65W 氮化镓充电器 - 青鸟数码旗舰店</title></head>
<body><main>
<h1>极光 65W 氮化镓充电器</h1>
<p>黑五狂欢价 <b>￥329</b> <s>￥599</s></p>
<ul>
<li>满减：满 300 减 40</li>
<li>店铺券：￥10，可与满减叠加使用</li>
<li>运费：￥12，满 99 包邮</li>
<li>发货：现货，48 小时内发出</li>
<li>售后：7 天无理由退货，一年质保</li>
</ul>
<h2>买家评价</h2>
<p>共 2.1 万条评价，好评率 96%</p>
<p>大家都在说：充电快 (5210) · 体积小 (3987) · 接口松动 (312) · 发热 (120)</p>
<article><p>★★★★★ 充笔记本很快，出差带着很方便。</p></article>
<article><p>★★☆☆☆ 用了三个月 C 口就松了，线一碰就断充。</p></article>
<article><p>★☆☆☆☆ 接口松动，客服只让我自己寄回，运费不给报。</p></article>
</main></body></html>`;

/** Local pages of the shopping tasks, by path. */
export const SHOP_PAGES: Record<string, string> = {
  '/volt.html': VOLT_HTML,
  '/volt-reviews.html': REVIEWS_HTML,
  '/volt-reviews-2.html': REVIEWS_2_HTML,
  '/volt-reviews-low.html': REVIEWS_LOW_HTML,
  '/volt-reviews-recent.html': REVIEWS_RECENT_HTML,
  '/voltmart.html': VOLTMART_HTML,
  '/cable.html': CABLE_HTML,
  '/chargers.html': CHARGERS_HTML,
  '/price.html': pricePage('$24.99'),
  '/zh.html': ZH_HTML,
};

/** Other stores, as the web search and the page fetcher of the test server answer for them. */
const STORES: { url: string; title: string; site: string; summary: string; content: string }[] = [
  {
    url: 'https://www.voltmart-online.com/p/volt-65w-gan-charger',
    title: 'Volt 65W GaN Charger | VoltMart',
    site: 'VoltMart',
    summary: 'Volt 65W GaN Charger for $31.50. Lowest price guaranteed.',
    content: '# Volt 65W GaN Charger\n\n**$31.50** · LOWEST PRICE GUARANTEED\n\nSold by QuickTrade Ltd (marketplace seller). Ships from overseas in 12–20 business days.\n\n- Shipping: $9.00\n- Returns: within 14 days. A 15% restocking fee applies.\n- Warranty: none.\n\nIn stock.',
  },
  {
    url: 'https://www.gadgetbarn-shop.com/chargers/volt-65w',
    title: 'Volt 65W GaN Charger – GadgetBarn',
    site: 'GadgetBarn',
    summary: 'Volt 65W GaN Charger, $29.99 with free shipping.',
    content: '# Volt 65W GaN Charger\n\n**$29.99** · Free shipping on every order\n\nOut of stock. Order now and it ships in about 5 weeks.\n\n- Returns: 30 days\n- Warranty: 1 year',
  },
  {
    url: 'https://www.primeparts-direct.com/volt-65w-gan',
    title: 'Volt 65W GaN Charger | PrimeParts',
    site: 'PrimeParts',
    summary: 'Volt 65W GaN Charger. $36.00, free shipping.',
    content: '# Volt 65W GaN Charger\n\n**$36.00** · Free shipping\n\nIn stock, ships today. Sold and shipped by PrimeParts.\n\n- Returns: 60 days, free\n- Warranty: 2 years',
  },
  {
    url: 'https://www.chargerweekly-mag.com/reviews/volt-65w-gan',
    title: 'Volt 65W GaN review: small, fast, and it has a problem',
    site: 'Charger Weekly',
    summary: 'Our Volt 65W test unit failed after nine weeks; readers report the same. The street price has hovered around $35 since summer.',
    content: '# Volt 65W GaN review\n\nSmall and fast. Our test unit stopped working after nine weeks, and many readers report the same. The street price has been around $35 since summer; the $59.99 list price is rarely charged.',
  },
];

/**
 * The stores' hosts. They are made up, but look like any shop's (a model
 * distrusts an address ending in ".example"). The evaluation's browser
 * resolves them to this computer, so nothing is ever sent to whoever may own
 * such a name.
 */
export const STORE_HOSTS = ['voltmart-online.com', 'gadgetbarn-shop.com', 'primeparts-direct.com', 'chargerweekly-mag.com'];

/** A booking page: a CAPTCHA, a day to choose, then a payment step. */
export const PASS_HTML = `<!doctype html><html lang="en"><head><title>Pinecrest Park day pass</title></head>
<body><h1>Pinecrest Park day pass</h1>
<div class="g-recaptcha" id="captcha" style="padding:20px;border:1px solid #999;width:260px"><button id="robot">I'm not a robot</button></div>
<form id="booking" hidden>
  <label>Day <select id="date"><option value="">Choose a day</option><option>This Saturday</option><option>This Sunday</option></select></label>
  <button type="button" id="continue">Continue</button>
</form>
<section id="payment" hidden><p>Total: $25 for <span id="chosen"></span></p><button id="pay">Pay now</button></section>
<p id="paid" hidden>Payment complete</p>
<script>
  document.getElementById('robot').addEventListener('click', () => { document.getElementById('captcha').remove(); document.getElementById('booking').hidden = false; });
  document.getElementById('continue').addEventListener('click', () => {
    const date = document.getElementById('date').value;
    if (!date) return;
    document.getElementById('booking').hidden = true;
    document.getElementById('payment').hidden = false;
    document.getElementById('chosen').textContent = date;
  });
  document.getElementById('pay').addEventListener('click', () => { document.getElementById('paid').hidden = false; });
</script></body></html>`;

SHOP_PAGES['/pass.html'] = PASS_HTML;

export const shopSearch = (query: string) =>
  /volt|65\s*w|gan|charger/i.test(query) ? STORES.map((store) => ({ title: store.title, url: store.url, summary: store.summary, snippet: store.summary, site_name: store.site, rerank_score: 2.2 })) : undefined;

export const shopFetch = (url: string) => {
  const store = STORES.find((entry) => url.startsWith(entry.url));
  return store && { title: store.title, content: store.content };
};
