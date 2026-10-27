import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ask, launch, openPanelFor, patchSettings, seed } from './helpers';
import { indexOf, MOCK_KEY, readTurn, say, startMockServer, type ChatMessage } from './mock-llm-server';

/**
 * The screenshots in the README, made with `pnpm screenshots`: real extension
 * pages on made-up sites, with a scripted model. Skipped unless
 * README_SCREENSHOTS names the output directory.
 */
const OUT = process.env.README_SCREENSHOTS;

const STORE = 'http://kestrel-supply.example/cables';
const GUIDE = 'http://brewline.example/espresso-for-beginners';
const SITE = { width: 1000, height: 840 };
/** Chrome draws its own header above the panel; the frame draws one too. */
const PANEL = { width: 420, height: SITE.height - 40 };
const SETTINGS = { width: 1000, height: 680 };

const cable = (name: string, details: string, rating: string, reviews: string, price: string, color: string, braided: boolean) => ({
  name,
  details,
  rating,
  reviews,
  price,
  color,
  braided,
});

const CABLES = [
  cable('Tern Braided USB-C Cable', 'Braided nylon · 2 m · 100 W', '4.8', '2,314', '$12.99', '#2f6f5e', true),
  cable('Loop Basic USB-C Cable', 'PVC · 1 m · 60 W', '4.1', '884', '$6.49', '#9aa3ab', false),
  cable('Strand Pro Braided USB-C', 'Braided nylon · 1 m · 240 W', '4.6', '1,027', '$18.50', '#3f4a8a', true),
  cable('Arc Braided USB-C Cable', 'Braided nylon · 1 m · 60 W', '4.3', '412', '$9.99', '#b5523b', true),
  cable('Loop Basic USB-C, 2-pack', 'PVC · 2 m · 60 W', '4.0', '1,530', '$10.99', '#c9ccd1', false),
  cable('Strand Braided USB-C, 3 m', 'Braided nylon · 3 m · 100 W', '4.5', '655', '$16.99', '#24313b', true),
];

const STORE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>USB-C cables – Kestrel Supply</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1d2329; background: #f6f7f9; }
  header { display: flex; align-items: center; gap: 28px; padding: 14px 28px; background: #14324a; color: #fff; }
  .logo { font-weight: 700; font-size: 18px; letter-spacing: .2px; }
  nav { display: flex; gap: 18px; color: #c4d3df; font-size: 13px; }
  .cart-link { margin-left: auto; font-size: 13px; color: #c4d3df; }
  form { display: flex; gap: 8px; padding: 18px 28px 6px; }
  form input { flex: 1; max-width: 520px; padding: 9px 12px; border: 1px solid #c8cfd6; border-radius: 8px; font: inherit; background: #fff; }
  form button { padding: 9px 16px; border: 0; border-radius: 8px; background: #14324a; color: #fff; font: inherit; font-weight: 600; }
  main { display: grid; grid-template-columns: 1fr 230px; gap: 20px; padding: 12px 28px 28px; }
  h1 { font-size: 17px; margin: 4px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .card { background: #fff; border: 1px solid #e3e7eb; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
  .thumb { height: 92px; border-radius: 8px; background: #eef1f4; display: grid; place-items: center; margin-bottom: 6px; }
  .name { font-weight: 600; font-size: 13.5px; }
  .details { color: #5b6670; font-size: 12px; }
  .rating { color: #b7791f; font-size: 12px; }
  .rating span { color: #5b6670; }
  .row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
  .price { font-weight: 700; font-size: 15px; }
  .card button { padding: 6px 10px; border: 1px solid #14324a; border-radius: 7px; background: #fff; color: #14324a; font: inherit; font-size: 12.5px; font-weight: 600; }
  aside { background: #fff; border: 1px solid #e3e7eb; border-radius: 12px; padding: 14px; align-self: start; }
  aside h2 { font-size: 15px; margin: 0 0 10px; }
  .line { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; padding: 6px 0; border-bottom: 1px solid #eef1f4; }
  .muted { color: #5b6670; }
  #place { width: 100%; margin-top: 12px; padding: 10px; border: 0; border-radius: 8px; background: #e07a1f; color: #fff; font: inherit; font-weight: 700; }
  #place:disabled { background: #e3e7eb; color: #8a949c; }
</style></head>
<body>
<header><span class="logo">Kestrel Supply</span><nav><span>Cables</span><span>Chargers</span><span>Audio</span><span>Deals</span></nav><span class="cart-link" id="cart-count">Cart (0)</span></header>
<form id="search"><input name="q" placeholder="Search products"><button>Search</button></form>
<main>
  <section><h1 id="heading">Popular in cables</h1><div class="grid" id="results"></div></section>
  <aside><h2>Your cart</h2><div id="lines"><p class="muted">Your cart is empty.</p></div>
    <div class="line"><span class="muted">Shipping</span><span>Free</span></div>
    <div class="line"><strong>Subtotal</strong><strong id="subtotal">$0.00</strong></div>
    <button id="place" disabled>Place order</button></aside>
</main>
<script>
  const cables = ${JSON.stringify(CABLES)};
  const cart = [];
  const thumb = (c) => '<svg width="120" height="70" viewBox="0 0 120 70" fill="none"><path d="M14 52 C 34 8, 60 8, 60 35 S 88 62, 106 18" stroke="' + c.color + '" stroke-width="' + (c.braided ? 7 : 5) + '" stroke-linecap="round"' + (c.braided ? ' stroke-dasharray="2 3"' : '') + '/><rect x="2" y="47" width="18" height="12" rx="3" fill="#59636c"/><rect x="100" y="8" width="18" height="12" rx="3" fill="#59636c"/></svg>';
  function render(list) {
    document.getElementById('results').innerHTML = list.map((c, i) =>
      '<div class="card"><div class="thumb">' + thumb(c) + '</div><div class="name">' + c.name + '</div><div class="details">' + c.details + '</div>' +
      '<div class="rating">★★★★★ ' + c.rating + ' <span>(' + c.reviews + ')</span></div>' +
      '<div class="row"><span class="price">' + c.price + '</span><button data-i="' + i + '" aria-label="Add ' + c.name + ' to cart">Add to cart</button></div></div>').join('');
    for (const button of document.querySelectorAll('.card button')) {
      button.addEventListener('click', () => { cart.push(list[Number(button.dataset.i)]); renderCart(); });
    }
  }
  function renderCart() {
    document.getElementById('lines').innerHTML = cart.map((c) => '<div class="line"><span>' + c.name + '</span><span>' + c.price + '</span></div>').join('');
    const total = cart.reduce((sum, c) => sum + Number(c.price.slice(1)), 0);
    document.getElementById('subtotal').textContent = '$' + total.toFixed(2);
    document.getElementById('cart-count').textContent = 'Cart (' + cart.length + ')';
    document.getElementById('place').disabled = cart.length === 0;
  }
  render(cables.slice(1, 4));
  document.getElementById('search').addEventListener('submit', (event) => {
    event.preventDefault();
    const words = new FormData(event.target).get('q').toLowerCase().split(/\\s+/).filter((w) => w !== 'usb-c' && w !== 'cable');
    document.getElementById('heading').textContent = 'Results for “' + new FormData(event.target).get('q') + '”';
    render(cables.filter((c) => words.every((w) => (c.name + c.details).toLowerCase().includes(w))).concat(cables.filter((c) => !c.braided)));
  });
</script></body></html>`;

const machine = (name: string, price: string, tone: string, text: string, specs: string[]) => `
  <section><div class="photo" style="background: linear-gradient(135deg, ${tone}, #2b211c)"></div>
  <div><h2>${name} <span class="price">${price}</span></h2><p>${text}</p><ul>${specs.map((s) => `<li>${s}</li>`).join('')}</ul></div></section>`;

const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Espresso machines for beginners – Brewline</title>
<style>
  body { margin: 0; font: 16px/1.6 Georgia, 'Times New Roman', serif; color: #2b211c; background: #fbf8f3; }
  header { display: flex; align-items: center; gap: 24px; padding: 16px 48px; border-bottom: 1px solid #eadfd2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .logo { font-weight: 800; font-size: 19px; color: #7a3e1d; }
  nav { display: flex; gap: 18px; font-size: 13px; color: #7b6a5d; }
  article { max-width: 760px; margin: 0 auto; padding: 28px 24px; }
  .kicker { font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #a0522d; }
  h1 { font-size: 34px; line-height: 1.2; margin: 6px 0 8px; }
  .byline { font: 13px -apple-system, BlinkMacSystemFont, sans-serif; color: #7b6a5d; margin-bottom: 18px; }
  section { display: grid; grid-template-columns: 170px 1fr; gap: 20px; margin: 22px 0; }
  .photo { height: 150px; border-radius: 10px; }
  h2 { font-size: 21px; margin: 0 0 4px; }
  .price { font: 600 14px -apple-system, BlinkMacSystemFont, sans-serif; color: #a0522d; margin-left: 6px; }
  p { margin: 0 0 8px; }
  ul { margin: 0; padding-left: 18px; font-size: 14.5px; color: #5a4a3f; }
</style></head>
<body>
<header><span class="logo">Brewline</span><nav><span>Guides</span><span>Reviews</span><span>Beans</span><span>Gear</span></nav></header>
<article>
  <div class="kicker">Buying guide</div>
  <h1>Espresso machines for beginners: three good picks</h1>
  <div class="byline">Updated this month · 9 min read</div>
  <p>Your first espresso machine should be forgiving. These three cover a beginner budget, an all-in-one option, and a machine to grow into.</p>
  ${machine('Breva Mini', '$249', '#c08457', 'A compact single-boiler machine that heats up in 30 seconds. You will need a separate grinder, and its basic steam wand takes practice.', ['No built-in grinder', 'Basic steam wand', 'Pressurized baskets included: easy to get started'])}
  ${machine('Corso Duo', '$499', '#8c5a3c', 'Grinds, tamps and froths for you, so the first latte comes out right. Fewer knobs to learn, and nothing else to buy.', ['Built-in conical grinder', 'Automatic milk frother', 'Guided dose and tamp'])}
  ${machine('Lumen Pro', '$899', '#5b3a29', 'A dual-boiler machine with full manual control and a commercial-grade steam wand. Rewarding, but it expects you to dial in every bag.', ['No built-in grinder', 'Commercial steam wand', 'PID temperature and pressure profiling'])}
</article></body></html>`;

const GUIDE_REPLY = [
  '| | Breva Mini | Corso Duo | Lumen Pro |\n',
  '|---|---|---|---|\n',
  '| Price | $249 | $499 | $899 |\n',
  '| Grinder | – | Built in | – |\n',
  '| Milk | Basic | Automatic | Pro wand |\n',
  '| Ease | Medium | Easy | Hard |\n\n',
  '**For a beginner: the Corso Duo.** It grinds and froths for you, so there is nothing else to buy. ',
  'Under $300? Take the Breva Mini plus a grinder.',
].join('');

/** Plays the model for both scenes. */
function assistant(messages: ChatMessage[]) {
  const { request, history, view } = readTurn(messages);
  const used = (tool: string) => history.includes(`- ${tool} `);
  if (request.includes('braided USB-C cable')) {
    if (history.includes('rejected')) return say('Stopped before paying. The Tern cable is in your cart.');
    if (!used('view_page')) return say('Let me look at the store.', 'view_page');
    if (!used('type')) {
      return say('Searching for braided USB-C cables.', 'type', {
        index: indexOf(view, /\[(\d+)\]<input[^\n]*placeholder="Search products"/),
        text: 'braided usb-c cable',
        submit: true,
      });
    }
    if (!used('extract')) return say('Comparing the results.', 'extract', { query: 'braided cables: price, length and rating' });
    if (!used('click')) {
      return say('The Tern cable is the best rated under $15. Adding it to the cart.', 'click', {
        index: indexOf(view, /\[(\d+)\]<button[^\n]*aria-label="Add Tern Braided USB-C Cable to cart"/),
      });
    }
    return say('Placing the order.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*>Place order<\/button>/) });
  }
  if (!used('read_page')) return say('', 'read_page');
  return say(GUIDE_REPLY);
}

const ICON = `data:image/png;base64,${readFileSync('public/icon/128.png').toString('base64')}`;
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** A browser window around a page and, beside it, the side panel. */
async function framed(context: BrowserContext, file: string, scene: { title: string; url: string; page: Buffer; size?: typeof SITE; panel?: Buffer }) {
  const canvas = await context.newPage();
  const size = scene.size ?? SITE;
  const width = size.width + (scene.panel ? PANEL.width + 1 : 0);
  await canvas.setViewportSize({ width: width + 80, height: size.height + 160 });
  await canvas.setContent(`<!doctype html><html><head><style>
    body { margin: 0; font: 12.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .backdrop { display: inline-block; padding: 36px 40px 40px; background: linear-gradient(160deg, #e3efe9, #f3eee6); }
    .window { width: ${width}px; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 24px 60px -12px rgba(20,40,32,.35); }
    .tabs { display: flex; align-items: end; gap: 14px; height: 38px; padding: 0 12px; background: #dfe3e1; }
    .dots { display: flex; gap: 7px; align-self: center; margin-right: 8px; }
    .dots i { width: 11px; height: 11px; border-radius: 50%; background: #c5cbc8; }
    .tab { display: flex; align-items: center; gap: 8px; width: 260px; height: 30px; padding: 0 12px; border-radius: 9px 9px 0 0; background: #fff; color: #2c3330; }
    .tab span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fav { flex: none; width: 13px; height: 13px; border-radius: 50%; background: #b9c2be; }
    .bar { display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 12px; border-bottom: 1px solid #e3e6e4; }
    .omni { flex: 1; height: 26px; display: flex; align-items: center; padding: 0 14px; border-radius: 13px; background: #f0f2f1; color: #47504c; }
    .ext { width: 18px; height: 18px; border-radius: 5px; }
    .body { display: flex; }
    .body > img { display: block; }
    .side { border-left: 1px solid #e3e6e4; }
    .side-head { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; color: #2c3330; font-weight: 600; }
    .side-head img { width: 16px; height: 16px; }
    .side-head span { margin-left: auto; color: #8a938f; font-size: 16px; font-weight: 400; }
  </style></head><body><div class="backdrop"><div class="window">
    <div class="tabs"><div class="dots"><i></i><i></i><i></i></div><div class="tab"><span class="fav"></span><span>${scene.title}</span></div></div>
    <div class="bar"><div class="omni">${scene.url}</div><img class="ext" src="${ICON}"></div>
    <div class="body"><img src="${dataUrl(scene.page)}" width="${size.width}" height="${size.height}">${
      scene.panel
        ? `<div class="side"><div class="side-head"><img src="${ICON}">Browser Helper Lite<span>✕</span></div><img src="${dataUrl(scene.panel)}" width="${PANEL.width}" height="${PANEL.height}"></div>`
        : ''
    }</div>
  </div></div></body></html>`);
  await canvas.waitForFunction(() => [...document.images].every((image) => image.complete));
  await canvas.locator('.backdrop').screenshot({ path: path.join(OUT!, file) });
  await canvas.close();
}

/** Lets fade-ins and the overlay's glow settle. */
const settle = (page: Page) => page.waitForTimeout(600);

test.describe.serial('README screenshots', () => {
  test.skip(!OUT, 'Set README_SCREENSHOTS to the output directory');

  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    mkdirSync(OUT!, { recursive: true });
    server = await startMockServer({
      assistant,
      pages: { '/cables': STORE_HTML, '/espresso-for-beginners': GUIDE_HTML },
      extractAnswer:
        'Braided and under $15: Tern Braided USB-C Cable (2 m, 100 W) $12.99, 4.8 stars from 2,314 reviews; Arc Braided USB-C Cable (1 m, 60 W) $9.99, 4.3 stars from 412 reviews. Strand Pro and the 3 m Strand are braided but cost more than $15.',
    });
    const port = new URL(server.origin).port;
    ({ context, extensionId } = await launch({
      deviceScaleFactor: 2,
      args: [`--host-resolver-rules=MAP *.example 127.0.0.1:${port}`, '--disable-features=HttpsUpgrades'],
    }));
    await seed(
      context,
      extensionId,
      {
        language: 'en',
        connections: [
          { id: 'deepseek', vendor: 'deepseek', name: 'DeepSeek', baseURL: `${server.origin}/v1`, models: ['deepseek-chat', 'deepseek-reasoner'], createdAt: 1, updatedAt: 1 },
        ],
        slots: { chat: { connectionId: 'deepseek', modelId: 'deepseek-chat' } },
        agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: false },
      },
      { deepseek: MOCK_KEY },
    );
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('the assistant shopping, waiting for approval to pay', async () => {
    const site = await context.newPage();
    await site.setViewportSize(SITE);
    await site.goto(STORE);
    const panel = await openPanelFor(context, extensionId, site);
    await panel.setViewportSize(PANEL);
    await expect(panel.getByTestId('page-chip')).toContainText('Kestrel Supply');
    await ask(panel, 'Find a braided USB-C cable under $15 with good reviews and order it.');
    await expect(panel.getByTestId('approval-card')).toContainText('Place order', { timeout: 30_000 });
    await expect(site.locator('#cart-count')).toHaveText('Cart (1)');
    await settle(site);
    await framed(context, 'agent.png', {
      title: 'USB-C cables – Kestrel Supply',
      url: 'kestrel-supply.example/cables',
      page: await site.screenshot(),
      panel: await panel.screenshot(),
    });
    await panel.getByTestId('approval-card').getByRole('button', { name: 'Deny' }).click();
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Stopped before paying');
  });

  test('a question about the page', async () => {
    const site = await context.newPage();
    await site.setViewportSize(SITE);
    await site.goto(GUIDE);
    const panel = await openPanelFor(context, extensionId, site);
    await panel.setViewportSize(PANEL);
    await ask(panel, 'Compare the three machines on this page. Which one should a beginner buy?');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('plus a grinder', { timeout: 30_000 });
    await settle(panel);
    await framed(context, 'chat.png', {
      title: 'Espresso machines for beginners – Brewline',
      url: 'brewline.example/espresso-for-beginners',
      page: await site.screenshot(),
      panel: await panel.screenshot(),
    });
  });

  test('model providers in Settings', async () => {
    const options = await context.newPage();
    await options.setViewportSize(SETTINGS);
    await options.goto(`chrome-extension://${extensionId}/options.html#providers`);
    const models = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);
    await patchSettings(options, (settings) => ({
      ...settings,
      connections: [
        { id: 'openai', vendor: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: models('gpt', 14), createdAt: 1, updatedAt: 1 },
        { id: 'anthropic', vendor: 'anthropic', name: 'Claude', baseURL: 'https://api.anthropic.com/v1', models: models('claude', 6), createdAt: 2, updatedAt: 2 },
        { id: 'google', vendor: 'google', name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', models: models('gemini', 9), createdAt: 3, updatedAt: 3 },
        { id: 'deepseek', vendor: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], createdAt: 4, updatedAt: 4 },
        { id: 'ollama', vendor: 'openai-compatible', presetId: 'ollama', name: 'Local models', baseURL: 'http://localhost:11434/v1', models: models('local', 3), createdAt: 5, updatedAt: 5 },
      ],
    }));
    await options.reload();
    await expect(options.getByText('Local models')).toBeVisible();
    await settle(options);
    await framed(context, 'settings.png', {
      title: 'Browser Helper Lite – Settings',
      url: 'Browser Helper Lite  ·  chrome-extension://…/options.html',
      page: await options.screenshot(),
      size: SETTINGS,
    });
  });
});
