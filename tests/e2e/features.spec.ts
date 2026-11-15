import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ask, launch, openSiteAndPanel, patchSettings, screenshot, seed } from './helpers';
import { indexOf, MOCK_KEY, MOCK_MODEL, readTurn, say, startMockServer, type ChatMessage, type ChatRequest, type Reply } from './mock-llm-server';

/** A page with one red block to mark. */
const RED_HTML = `<!doctype html><title>Red block</title><body style="margin:0;background:#fff">
<div style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#c00"></div><p style="margin:400px 20px">Text below the block.</p>`;

/** Two buttons at known places, to check where the replay says a click landed. */
const BUTTONS_HTML = `<!doctype html><title>Buttons</title><body style="margin:0;background:#fff">
<button id="first" style="position:absolute;left:100px;top:100px;width:120px;height:40px;background:#c00;border:0;color:#fff">First</button>
<button id="second" style="position:absolute;left:400px;top:300px;width:120px;height:40px;background:#06c;border:0;color:#fff">Second</button>
<p id="log" style="position:absolute;top:500px"></p>
<script>for (const id of ['first', 'second']) document.getElementById(id).addEventListener('click', () => { document.getElementById('log').textContent += id + ' '; });</script>`;

const TABLE = '| Cable | Price |\n|---|---|\n| Cable A | $9.99 |\n| Cable B | $5.49 |\n| Cable C | $12.00 |';

/** Long enough that reading it for a question is worth a second model's notes. */
const LONG_HTML = `<!doctype html><title>Cable prices</title><main><h1>Cable prices</h1><p>Cable C costs $12.00 this week.</p>${'<p>Our cables are tested for bends, pulls and heat before they ship to you.</p>'.repeat(40)}</main>`;

/** A product page as shops mark them up: the price and the rating are in its metadata. */
const PRODUCT_HTML = `<!doctype html><html lang="en"><head><title>Volt 65W charger</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Volt 65W charger',
  offers: { '@type': 'Offer', price: '34.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.4', reviewCount: '1286' },
})}</script></head><body><main><h1>Volt 65W charger</h1><p>Now <span>$34</span><sup>.99</sup></p><p>Charges a laptop and a phone.</p></main></body></html>`;

/** A page to use while the assistant works on it: text, a field, a button, and a count of what was pressed. */
const BUSY_HTML = `<!doctype html><title>Busy</title><body style="margin:0;background:#fff;font:16px sans-serif">
<p id="text" style="position:absolute;left:40px;top:40px;width:400px">Plain text of the page, to select and to click on.</p>
<button id="go" style="position:absolute;left:40px;top:120px;width:160px;height:50px" onclick="this.textContent='Started'">Start</button>
<input id="field" style="position:absolute;left:40px;top:200px;width:200px" placeholder="Notes">
<button id="other" style="position:absolute;left:40px;top:260px;width:160px;height:50px" onclick="this.textContent='Pressed'">Other</button>
</body>`;

const stockPage = (state: string) => `<!doctype html><title>65W charger</title><h1>65W charger</h1><p id="stock">${state}</p>`;
/** Served as they are at the moment of the request, so a test can change what a page says. */

// Pages that load a CAPTCHA. Most never ask anything of a person.
/** reCAPTCHA v3 or the invisible kind: a badge in the corner, a button the check is tied to, and the puzzle's frame parked off screen. */
const BADGE_HTML = `<!doctype html><title>Gotenda catalogue</title><h1>Routers</h1><p>AX12 Pro: 499 yuan.</p>
<form><button class="g-recaptcha" data-sitekey="k" data-callback="go" type="button">Subscribe</button>
<textarea name="g-recaptcha-response" style="display:none"></textarea></form>
<div class="grecaptcha-badge" style="position:fixed;bottom:14px;right:0;width:256px;height:60px;box-shadow:gray 0 0 5px"><iframe title="reCAPTCHA" width="256" height="60" src="/recaptcha/api2/anchor?ar=1&k=k&size=invisible"></iframe></div>
<div style="visibility:hidden;position:absolute;top:-10000px"><iframe title="recaptcha challenge expires in two minutes" style="width:400px;height:580px" src="/recaptcha/api2/bframe?k=k"></iframe></div>
<div class="h-captcha" data-sitekey="k" data-size="invisible" style="width:300px;height:70px"></div>`;
/** A box to tick. Ticking it fills in the answer; the box stays where it is. */
const CHECKBOX_HTML = `<!doctype html><title>Gotenda sign-up</title><h1>Sign up</h1><p>Members get 10% off.</p>
<form><div class="g-recaptcha" data-sitekey="k"><div style="width:304px;height:78px"><div><iframe title="reCAPTCHA" width="304" height="78" src="/recaptcha/api2/anchor?ar=1&k=k&size=normal"></iframe></div>
<textarea id="answer" name="g-recaptcha-response" style="display:none"></textarea></div></div></form>
<button id="tick" onclick="document.getElementById('answer').value = 'passed'">I'm not a robot</button>`;
/** A "checking your browser" page that passes by itself after a moment. */
const MOMENT_HTML = `<!doctype html><title>Just a moment…</title><div id="challenge-form" style="width:300px;height:80px">Checking your browser</div><p id="content" hidden>Opening hours: 9 to 6.</p>
<script>setTimeout(() => { document.title = 'Gotenda store'; document.getElementById('challenge-form').remove(); document.getElementById('content').hidden = false; }, 2500);</script>`;

const pages: Record<string, string> = { '/badge.html': BADGE_HTML, '/checkbox.html': CHECKBOX_HTML, '/moment.html': MOMENT_HTML, '/red.html': RED_HTML, '/buttons.html': BUTTONS_HTML, '/long.html': LONG_HTML, '/product.html': PRODUCT_HTML, '/stock.html': stockPage('Out of stock'), '/busy.html': BUSY_HTML };

function assistant(messages: ChatMessage[]): Reply {
  const { request, history, results } = readTurn(messages);
  const used = (tool: string) => history.includes(`- ${tool} `);
  const origin = /url="(https?:\/\/[^/"]+)/.exec(request)?.[1] ?? '';
  if (request.includes('FT-TABLE')) return say(`Here they are, with the **cheapest** in the middle:\n\n${TABLE}\n`);
  if (request.includes('FT-RESEARCH')) {
    if (!used('research_pages')) {
      return say('Reading the sources.', 'research_pages', { question: 'cable prices', urls: [`${origin}/review.html`, `${origin}/long.html`, 'https://unknown.example/prices'] });
    }
    const read = results.match(/<source/g)?.length ?? 0;
    return say(`Read ${read} pages; ${results.includes('this site has not come up in the task') ? 'one was left out' : 'none was left out'}.\n\n${TABLE}`);
  }
  if (request.includes('FT-REPLAY')) {
    const { view } = readTurn(messages);
    if (!used('view_page')) return say('Looking at the page.', 'view_page');
    const clicks = history.match(/- click /g)?.length ?? 0;
    if (clicks === 0) return say('Pressing the first button.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*>First<\/button>/) });
    if (clicks === 1) return say('Now the second one.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*>Second<\/button>/) });
    return say('Pressed both buttons.');
  }
  if (request.includes('FT-WATCH')) {
    // "LIVE": the user named a pace.
    const pace = request.includes('LIVE') ? { every_seconds: 10 } : {};
    if (!used('watch_page')) return say('I will keep an eye on it.', 'watch_page', { condition: 'The charger is back in stock', ...pace });
    return say(history.includes('rejected') || results.includes('did not want') ? 'I will not watch it.' : 'I am watching the page and will tell you.');
  }
  // A model that clicks "Add to cart" again right after it worked.
  if (request.includes('FT-TWICE')) {
    const { view } = readTurn(messages);
    if (!used('view_page')) return say('Looking at the shop.', 'view_page');
    if (!used('type')) return say('Searching.', 'type', { index: indexOf(view, /\[(\d+)\]<input[^\n]*placeholder="Search products"/), text: 'cable', submit: true });
    const clicks = history.match(/- click /g)?.length ?? 0;
    if (clicks < 2) return say('Adding Cable B.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*aria-label="Add Cable B to cart"/) });
    return say('Cable B is in the cart.');
  }
  // Works on the page, then keeps busy for a while.
  if (request.includes('FT-BUSY')) {
    const { view } = readTurn(messages);
    const waits = history.match(/- wait /g)?.length ?? 0;
    if (!used('view_page')) return say('Looking at the page.', 'view_page');
    if (!used('click')) return say('Starting.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*>Start<\/button>/) });
    if (waits < 4) return say('Waiting.', 'wait', { seconds: 3 });
    return say('Done waiting.');
  }
  // A model that goes in circles: the same address over and over, then the same failing click.
  if (request.includes('FT-LOOP')) {
    const opens = history.match(/- navigate /g)?.length ?? 0;
    const clicks = history.match(/- click /g)?.length ?? 0;
    if (opens < 6) return say('Opening it again.', 'navigate', { url: `${origin}/long.html` });
    if (clicks < 4) return say('Pressing it again.', 'click', { index: 987 });
    const refusedOpens = history.match(/- navigate [^\n]*→ Not opened: you have opened this address 4 times/g)?.length ?? 0;
    const failedClicks = history.match(/- click [^\n]*→ Error:/g)?.length ?? 0;
    const refusedClicks = history.match(/- click [^\n]*→ Not tried again: this exact action failed 2 times/g)?.length ?? 0;
    return say(`Opens refused: ${refusedOpens}. Clicks failed: ${failedClicks}, refused: ${refusedClicks}.`);
  }
  // A longer task in stages: each stage's result is given as it is ready.
  if (request.includes('FT-STAGES')) {
    const waits = history.match(/- wait /g)?.length ?? 0;
    if (!used('report_progress')) {
      return say('', 'report_progress', { stage: 'Candidates', step: 1, of: 2, content: '## Candidates\n\n| Cable | Price |\n|---|---|\n| Cable A | $9.99 |\n| Cable B | $5.49 |' });
    }
    if (waits < (request.includes('LONG') ? 6 : 1)) return say('Checking the reviews.', 'wait', { seconds: 3 });
    return say(`## Pick\n\nCable B. Reported: ${results.includes('Shown to the user as the next part of your answer') ? 'yes' : 'no'}.`);
  }
  // A page with a CAPTCHA on it: read like any other, unless it asks something of a person.
  if (request.includes('FT-CAPTCHA')) {
    // Looking at the page is where a check that needs a person is noticed.
    if (!used('view_page')) return say('Looking at the page.', 'view_page');
    if (!used('read_page')) return say('Reading the page.', 'read_page');
    return say(`Read: ${/AX12 Pro: 499 yuan|Members get 10% off|Opening hours: 9 to 6/.exec(results)?.[0] ?? 'nothing'}.`);
  }
  // What the user adds while the assistant works.
  if (request.includes('FT-ADDED')) return say(/The user adds, while you are working:\s*FT-ADDED not Cable A/.test(request) ? 'Understood: Cable A is out. Cable B it is.' : 'unexpected');
  if (request.includes('FT-REGION')) return say(results ? 'unexpected' : 'It is a red block.');
  return say('Nothing to do.');
}

const hasImage = (request: ChatRequest) => request.messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'));

/** The color in the middle of a picture shown in the panel. */
const middlePixel = (image: ReturnType<Page['locator']>) =>
  image.evaluate(async (element) => {
    const img = element as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const [red, green, blue] = context.getImageData(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2), 1, 1).data;
    return { red: red!, green: green!, blue: blue!, width: img.naturalWidth, height: img.naturalHeight };
  });

test.describe.serial('research, tables, pictures and reading aloud', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let site: Page;
  let panel: Page;

  test.beforeAll(async () => {
    server = await startMockServer({ assistant, pages });
    ({ context, extensionId } = await launch());
    // Chrome's voices are replaced by a list of what was said.
    await context.addInitScript(() => {
      const spoken: string[] = [];
      Object.assign(window, { __spoken: spoken });
      const fake = {
        cancel: () => undefined,
        getVoices: () => [],
        speak: (utterance: SpeechSynthesisUtterance) => {
          spoken.push(`${utterance.lang}|${utterance.text}`);
          setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 20);
        },
      };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    });
    await seed(
      context,
      extensionId,
      {
        connections: [{ id: 'mock', vendor: 'openai-compatible', presetId: 'custom', name: 'Mock provider', baseURL: `${server.origin}/v1`, models: [MOCK_MODEL], createdAt: 1, updatedAt: 1 }],
        slots: { chat: { connectionId: 'mock', modelId: MOCK_MODEL } },
        agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: false, screenshots: 'main' },
      },
      { mock: MOCK_KEY },
    );
    ({ site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/red.html`));
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  const lastReply = () => panel.getByTestId('assistant-message').last();
  const spoken = () => panel.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

  test('a table sorts by a column and downloads as CSV', async () => {
    await ask(panel, 'FT-TABLE compare the cables');
    await expect(lastReply().getByTestId('data-table')).toBeVisible({ timeout: 20_000 });
    const firstColumn = () => lastReply().locator('tbody tr td:first-child');
    await expect(firstColumn()).toHaveText(['Cable A', 'Cable B', 'Cable C']);
    const price = lastReply().locator('th', { hasText: 'Price' });
    await price.getByRole('button').click();
    await expect(firstColumn()).toHaveText(['Cable B', 'Cable A', 'Cable C']);
    await expect(price).toHaveAttribute('aria-sort', 'ascending');
    await price.getByRole('button').click();
    await expect(firstColumn()).toHaveText(['Cable C', 'Cable A', 'Cable B']);
    const download = panel.waitForEvent('download');
    await lastReply().getByTestId('download-csv').click();
    expect(readFileSync(await (await download).path(), 'utf8')).toBe('﻿Cable,Price\r\nCable C,$12.00\r\nCable A,$9.99\r\nCable B,$5.49');
    await price.getByRole('button').click();
    await expect(firstColumn()).toHaveText(['Cable A', 'Cable B', 'Cable C']);
    await screenshot(panel, 'feature-table');
  });

  test('a reply is read aloud on request, and by itself when that is turned on', async () => {
    await lastReply().getByTestId('speak').click();
    await expect.poll(spoken).toEqual(['en-US|Here they are, with the cheapest in the middle: Cable, Price. Cable A, $9.99. Cable B, $5.49. Cable C, $12.00']);
    await patchSettings(panel, (s) => ({ ...s, voice: { ...s.voice, speakReplies: true } }));
    await ask(panel, 'FT-NOTHING');
    await expect(lastReply()).toContainText('Nothing to do.', { timeout: 20_000 });
    await expect.poll(spoken).toHaveLength(2);
    expect((await spoken())[1]).toBe('en-US|Nothing to do.');
    await patchSettings(panel, (s) => ({ ...s, voice: { ...s.voice, speakReplies: false } }));
  });

  test('research reads several pages side by side and leaves out sites that did not come up', async () => {
    const tabs = context.pages().length;
    const extracts = server.extractRequests.length;
    await ask(panel, 'FT-RESEARCH which cable is cheapest?');
    await expect(lastReply()).toContainText('Read 2 pages; one was left out.', { timeout: 30_000 });
    // The long page gets a second model's notes; the short one is passed on as it is.
    expect(server.extractRequests.length).toBe(extracts + 1);
    expect(JSON.stringify(server.extractRequests.at(-1)!.messages)).toContain('cable prices');
    expect(JSON.stringify(server.extractRequests.at(-1)!.messages)).toContain('Cable C costs $12.00');
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('Braided cables last longer.');
    // The pages were read in background tabs that are closed again.
    await expect.poll(() => context.pages().length).toBe(tabs);
    const run = panel.getByTestId('agent-run').last();
    await run.getByTestId('run-details').click();
    await expect(run.locator('[data-tool="research_pages"]')).toContainText('Research: cable prices');
    await expect(run.locator('[data-tool="research_pages"]')).toContainText('3/3');
  });

  test('a part of the page is marked, shown and sent to the model as a picture', async () => {
    await panel.getByTestId('pick-region').click();
    // The page is dimmed and waits for a drag; a click alone does not count.
    await site.mouse.move(150, 150);
    await site.mouse.down();
    await site.mouse.up();
    await site.mouse.move(150, 150);
    await site.mouse.down();
    await site.mouse.move(350, 250, { steps: 4 });
    await site.mouse.up();
    const chip = panel.getByTestId('image-chip').locator('img');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    // 200×100 of the red block, with nothing of the picker left in it.
    const pixel = await middlePixel(chip);
    expect(pixel).toMatchObject({ width: 200, height: 100 });
    expect(pixel.red).toBeGreaterThan(180);
    expect(pixel.green + pixel.blue).toBeLessThan(60);

    await ask(panel, 'FT-REGION what is this?');
    await expect(lastReply()).toContainText('It is a red block.', { timeout: 20_000 });
    await expect(panel.getByTestId('image-chip')).toHaveCount(0);
    await expect(panel.getByTestId('user-message').last().getByTestId('message-image')).toBeVisible();
    const sent = server.chatRequests.at(-1)!;
    expect(hasImage(sent)).toBe(true);
    expect(JSON.stringify(sent.messages)).toContain('<attached_image size=\\"200x100\\"');
    await screenshot(panel, 'feature-region');

    // The next request does not carry the picture again.
    await ask(panel, 'FT-NOTHING');
    await expect(lastReply()).toContainText('Nothing to do.', { timeout: 20_000 });
    expect(hasImage(server.chatRequests.at(-1)!)).toBe(false);
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('attached_image');
  });

  test('Escape leaves the page as it was; a model that cannot look gets a reading from the vision model', async () => {
    await panel.getByTestId('pick-region').click();
    await site.mouse.move(150, 150);
    await site.keyboard.press('Escape');
    await site.mouse.move(160, 160);
    await expect(panel.getByTestId('image-chip')).toHaveCount(0);

    await patchSettings(panel, (s) => ({ ...s, agent: { ...s.agent, screenshots: 'vision' }, slots: { ...s.slots, vision: { connectionId: 'mock', modelId: 'mock-vision' } } }));
    await panel.getByTestId('pick-region').click();
    await site.mouse.move(120, 120);
    await site.mouse.down();
    await site.mouse.move(220, 220, { steps: 3 });
    await site.mouse.up();
    await expect(panel.getByTestId('image-chip')).toHaveCount(1, { timeout: 10_000 });
    const looks = server.lookRequests.length;
    await ask(panel, 'FT-REGION and this?');
    await expect(lastReply()).toContainText('It is a red block.', { timeout: 20_000 });
    expect(server.lookRequests.length).toBe(looks + 1);
    expect(JSON.stringify(server.lookRequests.at(-1)!.messages)).toContain('FT-REGION and this?');
    const sent = server.chatRequests.at(-1)!;
    expect(hasImage(sent)).toBe(false);
    expect(JSON.stringify(sent.messages)).toContain('A vision model read that image for you');
    expect(JSON.stringify(sent.messages)).toContain('The product with the braided black cable is Cable B.');
  });

  test('a finished task is replayed picture by picture, with a ring where it clicked', async () => {
    await site.goto(`${server.origin}/buttons.html`);
    // On screen, so the page can be pictured before the first step too.
    await site.bringToFront();
    await ask(panel, 'FT-REPLAY press both buttons');
    const run = panel.getByTestId('agent-run').last();
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(site.locator('#log')).toHaveText('first second');

    await run.getByTestId('replay-open').click();
    const replay = panel.getByTestId('replay');
    // It starts playing; pause on the first picture.
    await replay.getByTestId('replay-play').click();
    await expect(replay.getByRole('button', { name: 'Previous step' })).toBeDisabled();
    // Before the first click, before the second, and how it ended.
    await expect(replay.getByTestId('replay-position')).toHaveText('1 / 3');
    await expect(replay.getByTestId('replay-caption')).toContainText('Pressing the first button.');
    await expect(replay.getByTestId('replay-caption')).toContainText('Click button "First"');
    const frame = replay.getByTestId('replay-frame');
    /** The color of the picture under the ring, a little above its middle (clear of the button's label). */
    const underRing = async () => {
      const style = (await replay.getByTestId('replay-point').getAttribute('style'))!;
      const at = { x: Number(/left: ([\d.]+)%/.exec(style)![1]) / 100, y: Number(/top: ([\d.]+)%/.exec(style)![1]) / 100 };
      return frame.evaluate(async (element, at) => {
        const img = element as HTMLImageElement;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        const [red, green, blue] = context.getImageData(Math.round(at.x * img.naturalWidth), Math.round(at.y * img.naturalHeight) - 5, 1, 1).data;
        return { red: red!, green: green!, blue: blue!, width: img.naturalWidth };
      }, at);
    };
    // The picture shows the page, and the ring is where the click went: on the red button.
    const first = await underRing();
    expect(first.width).toBeLessThanOrEqual(640);
    expect(first.red).toBeGreaterThan(150);
    expect(first.green + first.blue).toBeLessThan(120);
    await screenshot(panel, 'feature-replay');

    await replay.getByTestId('replay-next').click();
    await expect(replay.getByTestId('replay-caption')).toContainText('Click button "Second"');
    // Then on the blue one.
    const second = await underRing();
    expect(second.blue).toBeGreaterThan(150);
    expect(second.red).toBeLessThan(80);
    await panel.keyboard.press('ArrowRight');
    await expect(replay.getByTestId('replay-position')).toHaveText('3 / 3');
    await expect(replay.getByTestId('replay-caption')).toContainText('Where the task ended.');
    await expect(replay.getByTestId('replay-point')).toHaveCount(0);
    await panel.keyboard.press('Escape');
    await expect(replay).toHaveCount(0);

    // With the setting off, nothing is pictured.
    await patchSettings(panel, (s) => ({ ...s, agent: { ...s.agent, recordSteps: false } }));
    await ask(panel, 'FT-REPLAY once more');
    await expect(panel.getByTestId('agent-run').last()).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('agent-run').last().getByTestId('replay-open')).toHaveCount(0);
  });

  test('a finished task is saved as a command and run again by name, with its steps as a hint', async () => {
    const run = panel.getByTestId('agent-run').last();
    await run.getByTestId('save-command').click();
    await run.getByTestId('command-name').fill('press both / buttons');
    await run.getByTestId('command-name').press('Enter');
    await expect(run.getByTestId('command-saved')).toHaveText('Saved. Type /press-both-buttons to run it again.');

    await panel.getByTestId('composer-input').fill('/press');
    await expect(panel.getByTestId('saved-command')).toContainText('FT-REPLAY once more');
    await panel.getByTestId('composer-input').press('Enter');
    await expect(panel.getByTestId('composer-input')).toHaveValue('FT-REPLAY once more');
    await expect(panel.getByTestId('command-chip')).toHaveText('/press-both-buttons');
    const runs = await panel.getByTestId('agent-run').count();
    await panel.getByTestId('composer-input').press('Enter');
    await expect(panel.getByTestId('agent-run')).toHaveCount(runs + 1, { timeout: 30_000 });
    await expect(panel.getByTestId('agent-run').last()).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('command-chip')).toHaveCount(0);
    await expect(site.locator('#log')).toHaveText('first second first second first second');
    // The model is told what worked last time, as data from a past run.
    const sent = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(sent).toContain('The user ran a saved command.');
    expect(sent).toMatch(/<previous_steps[^>]*command=\\"press-both-buttons\\"/);
    expect(sent).toContain('click button \\"First\\"\\nclick button \\"Second\\"');

    // The settings list it, and can delete it.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#agent`);
    const commands = options.getByTestId('saved-commands');
    await expect(commands).toContainText('/press-both-buttons');
    await commands.getByRole('button', { name: 'Delete' }).click();
    await expect(commands).not.toContainText('/press-both-buttons');
    await options.close();
    await panel.getByTestId('composer-input').fill('/press');
    await expect(panel.getByTestId('saved-command')).toHaveCount(0);
    await panel.getByTestId('composer-input').fill('');
  });

  /** The stored watches, read from the extension's database. */
  const storedWatches = () =>
    panel.evaluate(
      () =>
        new Promise<{ checks: number; checkedAt?: number; everySeconds: number; status: string; probe?: { parts: { locator: string; text: string }[] } }[]>((resolve) => {
          const open = indexedDB.open('browser-helper');
          open.onsuccess = () => {
            const request = open.result.transaction('watches').objectStore('watches').getAll();
            request.onsuccess = () => resolve(request.result);
          };
        }),
    );
  const alarms = () => panel.evaluate(async () => (await chrome.alarms.getAll()).map((alarm) => `${alarm.name.split(':')[0]}:${alarm.periodInMinutes}`));
  const notifications = () => panel.evaluate(() => new Promise<string[]>((resolve) => chrome.notifications.getAll((all) => resolve(Object.keys(all).map((id) => id.split('-')[0]!)))));

  test('a page is watched after the user agrees; the model is asked once and again only when what it named changes', async () => {
    await site.goto(`${server.origin}/stock.html`);
    // Refused: nothing is set up.
    await ask(panel, 'FT-WATCH tell me when it is back');
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('Watch 127.0.0.1: The charger is back in stock', { timeout: 20_000 });
    await expect(approval).toContainText('without touching it');
    // How often is the user's to say: five minutes unless they pick something else.
    await expect(approval.getByTestId('watch-pace')).toHaveValue('300');
    // One watch at a time: no "for this task", no "always on this site".
    await expect(approval.getByRole('button')).toHaveCount(2);
    await approval.getByRole('button', { name: /Deny/ }).click();
    await expect(lastReply()).toContainText('I will not watch it.', { timeout: 20_000 });
    expect(await alarms()).toEqual([]);

    const tabs = context.pages().length;
    const asked = server.watchRequests.length;
    await ask(panel, 'FT-WATCH tell me when it is back, please');
    await expect(approval).toBeVisible({ timeout: 20_000 });
    await approval.getByRole('button', { name: /Allow once/ }).click();
    await expect(lastReply()).toContainText('I am watching the page and will tell you.', { timeout: 20_000 });
    expect(await alarms()).toEqual(['watch:5']);

    await panel.getByTestId('open-watches').click();
    const item = panel.getByTestId('watch-item');
    await expect(item).toHaveAttribute('data-status', 'active');
    await expect(item).toContainText('The charger is back in stock');
    // The first look is taken right away, in a background tab that is closed again. The model is asked, and what it named is found in the page.
    await expect(item.getByTestId('watch-state')).toContainText('Watching · every 5 min', { timeout: 20_000 });
    await expect(item.getByTestId('watch-state')).toContainText('Still out of stock.', { timeout: 20_000 });
    await expect.poll(() => context.pages().length).toBe(tabs);
    expect(server.watchRequests.length).toBe(asked + 1);
    expect(JSON.stringify(server.watchRequests.at(-1)!.messages)).toContain('Condition: The charger is back in stock');
    expect((await storedWatches())[0]).toMatchObject({ checks: 1, probe: { parts: [{ locator: '#stock', text: 'Out of stock' }] } });

    // The timer fires: the page is opened and that element compared. It reads the same, so the model is not asked.
    const before = (await storedWatches())[0]!.checkedAt;
    await panel.evaluate(async () => {
      const [alarm] = await chrome.alarms.getAll();
      await chrome.alarms.create(alarm!.name, { when: Date.now() + 100, periodInMinutes: alarm!.periodInMinutes });
    });
    await expect.poll(async () => (await storedWatches())[0]!.checkedAt, { timeout: 20_000 }).not.toBe(before);
    expect(server.watchRequests.length).toBe(asked + 1);
    expect((await storedWatches())[0]).toMatchObject({ checks: 1, status: 'active' });
    expect(await notifications()).toEqual([]);

    // The page changes; the next look sees the element differ, asks the model, tells the user and stops watching.
    pages['/stock.html'] = stockPage('In stock');
    await panel.evaluate(async () => {
      const [alarm] = await chrome.alarms.getAll();
      await chrome.alarms.create(alarm!.name, { when: Date.now() + 100, periodInMinutes: alarm!.periodInMinutes });
    });
    await expect(item).toHaveAttribute('data-status', 'met', { timeout: 20_000 });
    await expect(item.getByTestId('watch-state')).toContainText('It happened');
    await expect(item.getByTestId('watch-state')).toContainText('The page says it is in stock.');
    expect(server.watchRequests.length).toBe(asked + 2);
    expect(await notifications()).toEqual(['watch']);
    expect(await alarms()).toEqual([]);
    await expect.poll(() => context.pages().length).toBe(tabs);
    await screenshot(panel, 'feature-watch');

    await item.getByRole('button', { name: 'Delete' }).click();
    await expect(panel.getByTestId('watch-item')).toHaveCount(0);
    expect(await notifications()).toEqual([]);
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(panel.getByTestId('composer-input')).toBeVisible();
  });

  test('a watch every second keeps its page open in the background and sees it change by itself', async () => {
    pages['/stock.html'] = stockPage('Out of stock');
    const asked = server.watchRequests.length;
    await ask(panel, 'FT-WATCH LIVE tell me the moment it is back');
    const approval = panel.getByTestId('approval-card');
    // The pace the model heard is offered; the user picks a faster one.
    await expect(approval.getByTestId('watch-pace')).toHaveValue('10', { timeout: 20_000 });
    await approval.getByTestId('watch-pace').selectOption('1');
    await expect(approval).toContainText('the page stays open in a collapsed tab group');
    await approval.getByRole('button', { name: /Allow once/ }).click();
    await expect(lastReply()).toContainText('I am watching the page and will tell you.', { timeout: 20_000 });
    // Chrome's timer reloads the page every half minute; the looking in between is done inside it.
    expect(await alarms()).toEqual(['watch:0.5']);

    await panel.getByTestId('open-watches').click();
    const item = panel.getByTestId('watch-item');
    await expect(item.getByTestId('watch-state')).toContainText('Watching · every 1 s', { timeout: 20_000 });
    await expect(item.getByTestId('watch-state')).toContainText('Still out of stock.', { timeout: 20_000 });
    const live = () => context.pages().filter((page) => page !== site && page.url().endsWith('/stock.html'));
    expect(live()).toHaveLength(1);
    expect(await panel.evaluate(async () => (await chrome.tabGroups.query({})).map((group) => `${group.title}:${group.collapsed}`))).toContain('Watching:true');
    expect(server.watchRequests.length).toBe(asked + 1);

    // Seconds pass and nothing changes: the model is not asked again.
    await panel.waitForTimeout(2500);
    expect(server.watchRequests.length).toBe(asked + 1);

    // The page itself changes what it shows (no reload: the server still says "Out of stock").
    await live()[0]!.evaluate(() => {
      document.getElementById('stock')!.textContent = 'In stock';
    });
    await expect(item).toHaveAttribute('data-status', 'met', { timeout: 20_000 });
    expect(server.watchRequests.length).toBe(asked + 2);
    expect(await notifications()).toEqual(['watch']);
    // Done: its page is closed and its timer gone.
    await expect.poll(() => live().length).toBe(0);
    expect(await alarms()).toEqual([]);

    // Watching again opens the page again; closing that tab is how to say stop.
    await item.getByRole('button', { name: 'Watch again' }).click();
    await expect(item).toHaveAttribute('data-status', 'active');
    await expect.poll(() => live().length, { timeout: 20_000 }).toBe(1);
    await expect(item.getByTestId('watch-state')).toContainText('Still out of stock.', { timeout: 20_000 });
    await live()[0]!.close();
    await expect(item).toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
    expect(await alarms()).toEqual([]);

    // A slower pace is set in the list.
    await item.getByTestId('watch-pace').selectOption('3600');
    await expect.poll(async () => (await storedWatches())[0]!.everySeconds).toBe(3600);
    await item.getByRole('button', { name: 'Delete' }).click();
    await expect(panel.getByTestId('watch-item')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Back' }).click();
  });

  test('on a product page, what shoppers ask is one click away, and the shop\'s own figures lead the page text', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/product.html`);
    const shop = opened.panel;
    // Compare prices, reviews, watch-outs and "good deal?" come first; the general page actions make room.
    await expect(shop.getByTestId('quick-prices')).toHaveText('Compare prices at other stores');
    await expect(shop.getByTestId('quick-reviews')).toBeVisible();
    await expect(shop.getByTestId('quick-flaws')).toBeVisible();
    await expect(shop.getByTestId('quick-deal')).toBeVisible();
    await expect(shop.getByTestId('quick-summarize')).toBeVisible();
    await expect(shop.getByTestId('quick-translate')).toHaveCount(0);
    await screenshot(shop, 'feature-shopping-actions');

    await shop.getByTestId('quick-reviews').click();
    await expect(shop.getByTestId('assistant-message').last()).toContainText('Nothing to do.', { timeout: 20_000 });
    const sent = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(sent).toContain("Summarize this product's reviews");
    // The page came along, led by what the shop states in its metadata: a price the text splits over two elements.
    expect(sent).toContain("Product data from the page's metadata");
    expect(sent).toContain('- Price: 34.99 USD');
    expect(sent).toContain('- Rating: 4.4 of 5 (1286 reviews)');
    // The slash menu has them too.
    await shop.getByTestId('composer-input').fill('/deal');
    await expect(shop.getByRole('option', { name: /Good deal\?/ })).toBeVisible();
    await shop.getByTestId('composer-input').fill('');
    await opened.site.close();
    await shop.close();

    // An ordinary page keeps the general actions.
    const plain = await openSiteAndPanel(context, extensionId, `${server.origin}/red.html`);
    await expect(plain.panel.getByTestId('quick-translate')).toBeVisible();
    await expect(plain.panel.getByTestId('quick-prices')).toHaveCount(0);
    await plain.site.close();
    await plain.panel.close();
  });

  test('"Add to cart" clicked again right after it worked is held back, and the page view says what the first click changed', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await ask(opened.panel, 'FT-TWICE add Cable B to the cart');
    await expect(opened.panel.getByTestId('assistant-message').last()).toContainText('Cable B is in the cart.', { timeout: 30_000 });
    // One in the cart, not two.
    await expect(opened.site.locator('#cart')).toHaveText('Cart: 1 item');
    const clicks = opened.panel.getByTestId('agent-run').last().locator('[data-testid="agent-action"][data-tool="click"]');
    await expect(clicks).toHaveCount(2);
    await expect(clicks.nth(0)).toHaveAttribute('data-status', 'done');
    await expect(clicks.nth(1)).toHaveAttribute('data-status', 'skipped');
    const sent = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(sent).toContain('Not clicked: this is the same button as in the step before');
    // What the first click did was said outright in the view after it; the held-back one changed nothing.
    expect(JSON.stringify(server.chatRequests.at(-2)!.messages)).toContain('Text that is new since the previous view:\\n- Cart: 1 item');
    expect(sent).toContain('No text changed in the viewport since the previous view.');
    await opened.site.close();
    await opened.panel.close();
  });

  test('a rush reloads the page every few seconds for a while; a CAPTCHA slows the watch down and says so', async () => {
    pages['/stock.html'] = stockPage('Out of stock');
    await site.goto(`${server.origin}/stock.html`);
    await ask(panel, 'FT-WATCH tell me when it is back, again');
    await panel.getByTestId('approval-card').getByRole('button', { name: /Allow once/ }).click({ timeout: 20_000 });
    await expect(lastReply()).toContainText('I am watching the page and will tell you.', { timeout: 20_000 });
    await panel.getByTestId('open-watches').click();
    const item = panel.getByTestId('watch-item');
    await expect(item.getByTestId('watch-state')).toContainText('Still out of stock.', { timeout: 20_000 });
    const live = () => context.pages().filter((page) => page !== site && page.url().endsWith('/stock.html'));
    // Every five minutes: the page is opened for a look and closed again.
    await expect.poll(() => live().length).toBe(0);
    const asked = server.watchRequests.length;
    const loads = () => server.hits.filter((hit) => hit === '/stock.html').length;

    // The user asks for a rush, and is told what it may cost.
    let asking = '';
    panel.once('dialog', (dialog) => {
      asking = dialog.message();
      void dialog.accept();
    });
    await item.getByTestId('watch-rush').click();
    await expect(item.getByTestId('watch-state')).toContainText('rush until', { timeout: 10_000 });
    expect(asking).toContain('reloaded every 5 seconds');
    expect(asking).toContain('CAPTCHA');
    // The page now stays open and is loaded again and again; the model is not asked, because nothing changed.
    const before = loads();
    await expect.poll(loads, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 3);
    expect(live()).toHaveLength(1);
    expect(server.watchRequests.length).toBe(asked);

    // The site answers with a CAPTCHA: the rush ends, the watch waits, and the user is told.
    pages['/stock.html'] = '<!doctype html><title>Just a moment…</title><div class="g-recaptcha" style="width:300px;height:80px;border:1px solid">Verify you are human</div>';
    await expect(item.getByTestId('watch-state')).toContainText('The site asks to verify that you are human.', { timeout: 30_000 });
    await expect(item.getByTestId('watch-state')).toContainText('slowed down, next look at');
    await expect(item.getByTestId('watch-state')).not.toContainText('rush until');
    await expect(item).toHaveAttribute('data-status', 'active');
    expect(await notifications()).toEqual(['watch']);
    expect(server.watchRequests.length).toBe(asked);
    // Left alone: no more loads, and the tab kept for the rush is gone.
    const after = loads();
    await panel.waitForTimeout(7000);
    expect(loads()).toBe(after);
    await expect.poll(() => live().length).toBe(0);

    await item.getByRole('button', { name: 'Delete' }).click();
    await expect(panel.getByTestId('watch-item')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Back' }).click();
  });

  test('using the page pauses the assistant only when the user presses or types something on it', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/busy.html`);
    const { site: busy, panel: side } = opened;
    const run = side.getByTestId('agent-run').last();
    await ask(side, 'FT-BUSY start and wait');
    await expect(busy.locator('#go')).toHaveText('Started', { timeout: 20_000 });
    await expect(run).toHaveAttribute('data-status', 'running');
    await busy.bringToFront();

    // What leaves the page as it is: keys held with others, shortcuts, keys that scroll, the other mouse buttons, a click on text or on empty space.
    await busy.keyboard.press('Shift');
    await busy.keyboard.press('Meta');
    await busy.keyboard.press('ControlOrMeta+c');
    await busy.keyboard.press('Alt+Shift+h');
    await busy.keyboard.press('F5').catch(() => undefined);
    await busy.keyboard.press('PageDown');
    await busy.keyboard.press('Space');
    await busy.mouse.click(600, 500);
    await busy.locator('#text').click();
    await busy.locator('#text').dblclick();
    await busy.locator('#other').click({ button: 'right' });
    await busy.waitForTimeout(1200);
    await expect(run).toHaveAttribute('data-status', 'running');
    await expect(busy.locator('#other')).toHaveText('Other');

    // Typing into a field takes the page over.
    await busy.locator('#field').focus();
    await busy.keyboard.type('mine');
    await expect(run).toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
    await expect(side.getByTestId('agent-run').last()).toContainText('Paused because you used the page.');
    await side.bringToFront();
    await side.getByTestId('agent-controls').getByRole('button', { name: 'Resume' }).click();
    await expect(run).toHaveAttribute('data-status', 'running', { timeout: 10_000 });

    // So does pressing a button.
    await busy.bringToFront();
    await busy.waitForTimeout(1100);
    await busy.locator('#other').click();
    await expect(busy.locator('#other')).toHaveText('Pressed');
    await expect(run).toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
    await side.bringToFront();
    await side.getByTestId('agent-controls').getByRole('button', { name: 'Resume' }).click();
    await expect(side.getByTestId('assistant-message').last()).toContainText('Done waiting.', { timeout: 40_000 });
    await busy.close();
    await side.close();
  });

  test('going in circles is stopped: an address opened over and over, an action that keeps failing the same way', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/red.html`);
    const before = server.hits.filter((hit) => hit === '/long.html').length;
    await ask(opened.panel, 'FT-LOOP go on');
    // Four opens went through, the fifth and sixth did not; two clicks failed, the third and fourth were not tried.
    await expect(opened.panel.getByTestId('assistant-message').last()).toContainText('Opens refused: 2. Clicks failed: 2, refused: 2.', { timeout: 60_000 });
    expect(server.hits.filter((hit) => hit === '/long.html').length - before).toBe(4);
    await opened.site.close();
    await opened.panel.close();
  });

  test('a longer task gives each stage\'s result as it is ready, and the final reply follows them', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/red.html`);
    const side = opened.panel;
    await ask(side, 'FT-STAGES which cable?');
    // While it still works: the first part of the answer is there, as a table, and the run says which stage was reached.
    const run = side.getByTestId('agent-run').last();
    const reply = side.getByTestId('assistant-message').last();
    await expect(reply.getByRole('heading', { name: 'Candidates' })).toBeVisible({ timeout: 20_000 });
    await expect(run).toHaveAttribute('data-status', 'running');
    await expect(run.getByTestId('run-stage')).toHaveText('1/2 Candidates');
    await expect(reply.getByTestId('data-table')).toBeVisible();
    // Done: both parts, in their order, in one reply; the model was told that the first was shown.
    await expect(reply.getByRole('heading', { name: 'Pick' })).toBeVisible({ timeout: 20_000 });
    await expect(reply).toContainText('Cable B. Reported: yes.');
    await expect(reply.getByRole('heading')).toHaveText(['Candidates', 'Pick']);
    await expect(side.getByTestId('assistant-message')).toHaveCount(1);
    await expect(run.getByTestId('run-stage')).toHaveCount(0);
    // Kept with the conversation.
    await side.reload();
    await expect(side.getByTestId('assistant-message').last().getByRole('heading')).toHaveText(['Candidates', 'Pick'], { timeout: 15_000 });
    await opened.site.close();
    await side.close();
  });

  test('what the user types while the assistant works reaches it before its next step; a stopped task keeps what it had given', async () => {
    const opened = await openSiteAndPanel(context, extensionId, `${server.origin}/red.html`);
    const side = opened.panel;
    await ask(side, 'FT-STAGES LONG which cable?');
    const run = side.getByTestId('agent-run').last();
    await expect(side.getByTestId('assistant-message').last().getByRole('heading', { name: 'Candidates' })).toBeVisible({ timeout: 20_000 });
    // The box takes an addition to the task under way; Stop stays next to it.
    const input = side.getByTestId('composer-input');
    await expect(input).toHaveAttribute('placeholder', 'Add something while it works…');
    await expect(side.getByTestId('add-button')).toHaveCount(0);
    await input.fill('FT-ADDED not Cable A');
    await expect(side.getByTestId('add-button')).toBeVisible();
    await expect(side.getByTestId('stop-button')).toBeVisible();
    await input.press('Enter');
    await expect(input).toHaveValue('');
    // It is part of the conversation, and the assistant answers to it at its next step instead of waiting on.
    await expect(side.getByTestId('user-message').last()).toContainText('FT-ADDED not Cable A');
    await expect(side.getByTestId('assistant-message').last()).toContainText('Understood: Cable A is out. Cable B it is.', { timeout: 20_000 });
    await expect(run).toHaveAttribute('data-status', 'done');
    // The candidates given before stay in the reply.
    await expect(side.getByTestId('assistant-message').last().getByRole('heading', { name: 'Candidates' })).toBeVisible();
    expect(server.chatRequests.at(-1)!.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('The user adds, while you are working'))).toBe(true);

    // Stopped midway: the part that was given is kept.
    await ask(side, 'FT-STAGES LONG again');
    const second = side.getByTestId('assistant-message').last();
    await expect(second.getByRole('heading', { name: 'Candidates' })).toBeVisible({ timeout: 20_000 });
    await side.getByTestId('stop-button').click();
    await expect(side.getByTestId('agent-run').last()).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 });
    await expect(side.getByTestId('assistant-message').last()).toContainText('The task was stopped.');
    await expect(side.getByTestId('assistant-message').last().getByRole('heading', { name: 'Candidates' })).toBeVisible();
    await opened.site.close();
    await side.close();
  });

  test('a CAPTCHA badge in the corner is no reason to stop; a box to tick is, until it is ticked', async () => {
    // reCAPTCHA v3 and the invisible kinds: a badge, a hidden puzzle frame, a button tied to the check. Nobody has to do anything.
    const badge = await openSiteAndPanel(context, extensionId, `${server.origin}/badge.html`);
    await ask(badge.panel, 'FT-CAPTCHA what does the router cost?');
    await expect(badge.panel.getByTestId('assistant-message').last()).toContainText('Read: AX12 Pro: 499 yuan.', { timeout: 20_000 });
    await expect(badge.panel.getByTestId('handoff-card')).toHaveCount(0);
    await badge.site.close();
    await badge.panel.close();

    // A box to tick on screen: the user is asked, and the task goes on once it is ticked, although the box is still there.
    const box = await openSiteAndPanel(context, extensionId, `${server.origin}/checkbox.html`);
    await ask(box.panel, 'FT-CAPTCHA what do members get?');
    await expect(box.panel.getByTestId('handoff-card')).toContainText('Please solve the verification', { timeout: 20_000 });
    await box.site.click('#tick');
    await expect(box.panel.getByTestId('assistant-message').last()).toContainText('Read: Members get 10% off.', { timeout: 20_000 });
    expect(await box.site.locator('.g-recaptcha iframe').count()).toBe(1);
    await box.site.close();
    await box.panel.close();

    // A check that passes by itself within a few seconds is waited for; the user is not asked.
    const moment = await openSiteAndPanel(context, extensionId, `${server.origin}/moment.html`);
    let asked = false;
    void moment.panel.getByTestId('handoff-card').waitFor({ timeout: 15_000 }).then(() => (asked = true)).catch(() => undefined);
    // Loaded again, so the check is on the page when the assistant first looks.
    await moment.site.reload();
    await ask(moment.panel, 'FT-CAPTCHA when is it open?');
    await expect(moment.panel.getByTestId('assistant-message').last()).toContainText('Read: Opening hours: 9 to 6.', { timeout: 20_000 });
    expect(asked).toBe(false);
    await moment.site.close();
    await moment.panel.close();
  });
});
