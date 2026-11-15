import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ask, groupOf, launch, openSiteAndPanel, patchSettings, screenshot, seed, tabIdOf } from './helpers';
import { indexOf, MOCK_KEY, MOCK_MODEL, readTurn, say, startMockServer, type ChatMessage, type Reply } from './mock-llm-server';

/** A product page as shops mark them up, with its picture in the metadata and a larger one in the text. */
const PRODUCT_HTML = `<!doctype html><html lang="en"><head><title>Volt 65W charger</title>
<script>document.cookie = 'session=shopper-1; path=/';</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Volt 65W charger',
  image: ['/pic/red-volt.png'],
  offers: { '@type': 'Offer', price: '34.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
})}</script></head><body><main><h1>Volt 65W charger</h1><p>Now $34.99. Charges a laptop and a phone.</p>
<p><label>Cable <select id="cable"><option>None</option><option selected>1 m</option><option>2 m</option></select></label></p>
<img src="/pic/blue-side.png" width="200" height="160" alt="Side view"><img src="/pic/dot-track.png" width="1" height="1" alt=""><img src="/pic/green-icon.png" width="24" height="24" alt="Free shipping"></main></body></html>`;

const BUTTONS_HTML = `<!doctype html><title>Buttons</title><body style="margin:0;background:#fff">
<button id="first" style="position:absolute;left:100px;top:100px;width:160px;height:60px" onclick="this.textContent='First ✓'">First</button></body>`;

const thread = (n: number) => `<!doctype html><title>Volt 65W charger: thread ${n}</title><main><h1>Volt 65W charger, thread ${n}</h1>
<p>Owner report ${n}: it runs warm after an hour.</p>
<button aria-label="Upvote" onclick="votes.textContent = String(Number(votes.textContent) + 1)">▲</button> <span id="votes">0</span>
<a href="/forum/thread-${n + 1}.html">Next thread</a></main>`;

const pages: Record<string, string> = {
  '/product.html': PRODUCT_HTML,
  '/buttons.html': BUTTONS_HTML,
  '/plain.html': '<!doctype html><title>Plain</title><p>A plain page.</p>',
  '/other.html': '<!doctype html><title>Other</title><p>Another page.</p>',
  '/third.html': '<!doctype html><title>Third</title><p>A third page.</p>',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/forum/thread-${i + 1}.html`, thread(i + 1)])),
};

const FORUM_SKILL = `---
name: Forum Check
description: Use when the user asks what the charger forum says about a product.
---

1. Search https://forum.example/search for the model and the word "problems".
2. Report the three complaints that come up most, each with a link.
`;

function assistant(messages: ChatMessage[]): Reply {
  const { request, history, results, view } = readTurn(messages);
  const used = (tool: string) => history.includes(`- ${tool} `);
  const origin = /url="(https?:\/\/[^/"]+)/.exec(request)?.[1] ?? '';
  // The price comparison: the page came with the request, and the skill with it.
  if (request.includes('Compare prices for this product')) {
    const picture = /- Picture: (\S+)/.exec(request)?.[1] ?? 'none';
    const side = /!\[Side view\]\((\S+?)\)/.exec(request)?.[1] ?? 'none';
    return say(
      [
        `Skill: ${request.includes('<skill name="compare-prices">') ? 'compare-prices' : 'none'}.`,
        `![Volt 65W charger](${picture})`,
        `**Volt 65W charger** · $34.99 · in stock · [Open the page](${origin}/product.html)`,
        `![Side view](${side})`,
        // Not on the page: one made up, one changed to carry something.
        `![Other](${origin}/pic/green-made-up.png)`,
        `![Volt again](${picture}?note=shopper)`,
      ].join('\n\n'),
    );
  }
  if (request.includes('SK-LOAD')) {
    if (!used('load_skill')) return say('Getting the skill.', 'load_skill', { name: 'reputation' });
    return say(`Loaded: ${results.includes('<skill name="reputation">') ? 'yes' : 'no'}. Only reads: ${results.includes('Do not like, follow, comment') ? 'yes' : 'no'}.`);
  }
  if (request.includes('SK-USE')) return say(request.includes('<skill name="forum-check">') && request.includes('Report the three complaints') ? 'Used forum-check.' : 'No skill came along.');
  if (request.includes('SK-CLICK')) {
    if (!used('view_page')) return say('Looking at the page.', 'view_page');
    if (!used('click')) return say('Pressing the button.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*>First<\/button>/) });
    return say('Pressed it.');
  }
  if (request.includes('SK-FORUM')) {
    const navigations = history.match(/- navigate /g)?.length ?? 0;
    if (!used('view_page')) return say('Looking at the thread.', 'view_page');
    // A model that pays no attention to the note about the limit.
    if (navigations < 8) return say('The next thread.', 'navigate', { url: `${origin}/forum/thread-${navigations + 2}.html` });
    if (!used('research_pages')) return say('Reading the rest side by side.', 'research_pages', { question: 'problems with the charger', urls: [`${origin}/forum/thread-10.html`] });
    if (!used('click')) return say('Upvoting the report.', 'click', { index: indexOf(view, /\[(\d+)\]<button[^\n]*aria-label="Upvote"/) });
    return say(
      [
        `Ninth page: ${/- navigate [^\n]*thread-9[^\n]*→ You have looked at 8 pages on smzdm\.com/.test(history) ? 'refused' : 'opened'}.`,
        `In the background: ${results.includes('open it in the tab') ? 'refused' : 'read'}.`,
        `Vote: ${results.includes('The user rejected this action') ? 'not cast' : 'cast'}.`,
      ].join(' '),
    );
  }
  // A forum the user put on the list, with a limit of two pages.
  if (request.includes('SK-OWN')) {
    const navigations = history.match(/- navigate /g)?.length ?? 0;
    if (!used('view_page')) return say('Looking at the thread.', 'view_page');
    if (navigations < 2) return say('The next thread.', 'navigate', { url: `${origin}/forum/thread-${navigations + 2}.html` });
    if (!used('research_pages')) return say('Reading another side by side.', 'research_pages', { question: 'problems', urls: [`${origin}/forum/thread-5.html`] });
    return say(`Third page: ${/- navigate [^\n]*thread-3[^\n]*→ You have looked at 2 pages on myforum\.test/.test(history) ? 'refused' : 'opened'}. In the background: ${results.includes('open it in the tab') ? 'refused' : 'read'}.`);
  }
  return say('Nothing to do.');
}

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

test.describe.serial('skills, product pictures, grouped tabs and forums', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    server = await startMockServer({ assistant, pages, files: { '/skills/forum.md': FORUM_SKILL.replace('Forum Check', 'Remote Forum') } });
    // The forum is the mock server under a social site's name.
    ({ context, extensionId } = await launch({ args: ['--host-resolver-rules=MAP www.smzdm.com 127.0.0.1, MAP bbs.myforum.test 127.0.0.1'] }));
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
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  const systemPrompt = () => {
    const first = server.chatRequests.at(-1)!.messages[0]!;
    return typeof first.content === 'string' ? first.content : JSON.stringify(first.content);
  };

  test('a shopping action takes its skill along, and the reply shows the pictures the page had and no other', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/product.html`);
    // What people say about it elsewhere is one of the actions now.
    await expect(panel.getByTestId('quick-reputation')).toHaveText('What people say about it');
    await panel.getByTestId('quick-prices').click();
    const reply = panel.getByTestId('assistant-message').last();
    await expect(reply).toContainText('Skill: compare-prices.', { timeout: 20_000 });

    // The prompt names the skills by a line each; how to compare prices came with the request.
    const prompt = systemPrompt();
    expect(prompt).toContain('- compare-prices: Use when the user asks to compare prices across stores');
    expect(prompt).toContain('- reputation:');
    expect(prompt).not.toContain('Do not add to a cart or open a checkout');
    const sent = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(sent).toContain('Do not add to a cart or open a checkout');
    // The page text names its larger pictures by address, and the product's own first; an icon and a tracking pixel only by description.
    expect(sent).toContain(`- Picture: ${server.origin}/pic/red-volt.png`);
    expect(sent).toContain(`![Side view](${server.origin}/pic/blue-side.png)`);
    expect(sent).toContain('[image: Free shipping]');
    // A list's choices are in the text, with the one that is chosen.
    expect(sent).toContain('(choices: None | 1 m (chosen) | 2 m)');
    expect(sent).not.toContain('dot-track');

    // The two pictures of the page are shown, from the copies the extension keeps.
    const pictures = reply.getByTestId('reply-picture');
    await expect(pictures).toHaveCount(2, { timeout: 15_000 });
    expect(await pictures.first().getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
    expect(await middlePixel(pictures.first())).toMatchObject({ width: 200, height: 160 });
    const red = await middlePixel(pictures.first());
    expect(red.red).toBeGreaterThan(180);
    expect(red.blue).toBeLessThan(80);
    expect((await middlePixel(pictures.nth(1))).blue).toBeGreaterThan(180);
    // The made-up address and the changed one stay links that were never fetched.
    await expect(reply.getByTestId('blocked-image')).toHaveCount(2);
    const fetched = server.pictureRequests.filter((request) => request.referer === undefined || !request.referer.includes('/product.html'));
    expect(fetched.map((request) => request.url).sort()).toEqual(['/pic/blue-side.png', '/pic/red-volt.png']);
    // Without the shop's cookie, and without saying where the address came from.
    for (const request of fetched) expect(request).toEqual({ url: request.url, cookie: undefined, referer: undefined });
    expect(server.hits.some((hit) => hit.includes('made-up') || hit.includes('note=shopper'))).toBe(false);
    // The page itself did send its cookie: it was there to be sent.
    expect(server.pictureRequests.some((request) => request.cookie?.includes('session=shopper-1'))).toBe(true);
    await expect(reply.getByRole('link', { name: 'Open the page' })).toHaveAttribute('href', `${server.origin}/product.html`);
    await screenshot(panel, 'feature-product-pictures');

    // They are kept with the conversation: nothing is fetched again when it is shown again.
    const before = server.pictureRequests.length;
    await panel.reload();
    await expect(panel.getByTestId('assistant-message').last().getByTestId('reply-picture')).toHaveCount(2, { timeout: 15_000 });
    expect(server.pictureRequests.length).toBe(before);
    await site.close();
    await panel.close();
  });

  test('the model loads a skill when the work comes up; one that is turned off is not there to load', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/plain.html`);
    await ask(panel, 'SK-LOAD what do people say about the Volt 65W?');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Loaded: yes. Only reads: yes.', { timeout: 20_000 });

    await patchSettings(panel, (settings) => ({ ...settings, skills: { installed: [], off: ['reputation'] } }));
    await ask(panel, 'SK-LOAD and now?');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Loaded: no.', { timeout: 20_000 });
    expect(systemPrompt()).not.toContain('- reputation:');
    expect(systemPrompt()).toContain('- compare-prices:');
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('There is no skill called');
    await patchSettings(panel, (settings) => ({ ...settings, skills: { installed: [], off: [] } }));
    await site.close();
    await panel.close();
  });

  test('a skill is read before it is installed, used by its name after a slash, changed and removed', async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#skills`);
    await expect(options.getByTestId('builtin-skills').getByTestId('skill-row')).toHaveCount(5);
    await expect(options.getByTestId('builtin-skills')).toContainText('Compare prices');
    await expect(options.getByTestId('builtin-skills')).toContainText('reputation');

    // Not a skill file: said so, and nothing is installed.
    await options.getByTestId('skill-file').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('Just some notes.') });
    await expect(options.getByTestId('skill-problem')).toContainText('This is not a skill file');
    await expect(options.getByTestId('skill-form')).toHaveCount(0);

    // From a file: its whole text is shown first, with the sites it names.
    await options.getByTestId('skill-file').setInputFiles({ name: 'forum.md', mimeType: 'text/markdown', buffer: Buffer.from(FORUM_SKILL) });
    const form = options.getByTestId('skill-form');
    await expect(form).toContainText('Read it before installing');
    await expect(form).toContainText('Install only what you have read');
    await expect(form.locator('#skill-name')).toHaveValue('forum-check');
    await expect(form.locator('#skill-instructions')).toHaveValue(/Report the three complaints/);
    await expect(form.getByTestId('skill-sites')).toHaveText('Sites it names: forum.example');
    await expect(options.getByTestId('installed-skills').getByTestId('skill-row')).toHaveCount(0);
    await screenshot(options, 'feature-skill-install');
    await form.getByTestId('skill-install').click();
    const installed = options.getByTestId('installed-skills').getByTestId('skill-row');
    await expect(installed).toHaveCount(1);
    await expect(installed).toContainText('/forum-check');

    // The same name again is refused.
    await options.getByTestId('skill-file').setInputFiles({ name: 'forum.md', mimeType: 'text/markdown', buffer: Buffer.from(FORUM_SKILL) });
    await options.getByTestId('skill-install').click();
    await expect(options.getByTestId('skill-problem')).toContainText('installed already');
    await options.getByRole('button', { name: 'Cancel' }).click();

    // From an address: fetched to be read, installed only by the button.
    await options.getByTestId('skill-address').fill(`${server.origin}/skills/forum.md`);
    await options.getByTestId('skill-fetch').click();
    await expect(options.locator('#skill-name')).toHaveValue('remote-forum', { timeout: 10_000 });
    await expect(installed).toHaveCount(1);
    await options.getByTestId('skill-install').click();
    await expect(installed).toHaveCount(2);

    // In the panel: after a slash, by its name; it goes with the request.
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/plain.html`);
    await panel.getByTestId('composer-input').fill('/forum-c');
    await panel.getByTestId('skill-option').click();
    await expect(panel.getByTestId('skill-chip')).toHaveText('/forum-check');
    await ask(panel, 'SK-USE which complaints?');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Used forum-check.', { timeout: 20_000 });
    await expect(panel.getByTestId('skill-chip')).toHaveCount(0);
    expect(systemPrompt()).toContain('- forum-check: Use when the user asks what the charger forum says about a product.');

    // Turned off: not offered, not listed.
    await options.bringToFront();
    await installed.first().getByRole('switch').click();
    await panel.bringToFront();
    await panel.getByTestId('composer-input').fill('/forum-c');
    await expect(panel.getByTestId('skill-option')).toHaveCount(0);
    await panel.getByTestId('composer-input').fill('');

    // Changed, written by hand, and removed.
    await options.bringToFront();
    await installed.first().getByRole('button', { name: 'Edit' }).click();
    await options.locator('#skill-name').fill('Charger Forum');
    await options.getByTestId('skill-install').click();
    await expect(installed.first()).toContainText('/charger-forum');
    await options.getByTestId('skill-write').click();
    await options.locator('#skill-name').fill('compare-prices');
    await options.locator('#skill-description').fill('Use for prices.');
    await options.locator('#skill-instructions').fill('Look at prices.');
    await options.getByTestId('skill-install').click();
    await expect(options.getByTestId('skill-problem')).toContainText('built-in skill has this name');
    await options.locator('#skill-name').fill('my prices');
    await options.getByTestId('skill-install').click();
    await expect(installed).toHaveCount(3);
    const stored = await options.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1'].skills);
    expect(stored.installed.map((skill: { name: string }) => skill.name)).toEqual(['charger-forum', 'remote-forum', 'my-prices']);
    expect(stored.off).toEqual(['charger-forum']);
    for (let left = 2; left >= 0; left--) {
      await installed.first().getByRole('button', { name: 'Delete' }).click();
      await expect(installed).toHaveCount(left);
    }
    // A built-in one can be turned off, not removed.
    await options.locator('#skill-deal-check').click();
    expect((await options.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1'].skills)).off).toEqual(['deal-check']);
    await options.locator('#skill-deal-check').click();
    await site.close();
    await panel.close();
    await options.close();
  });

  test("a tab that comes into the assistant's group shows the group's conversation", async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/buttons.html`);
    await ask(panel, 'SK-CLICK press the button');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Pressed it.', { timeout: 30_000 });
    await expect.poll(() => groupOf(panel, site.url())).toBeTruthy();
    const linked = (tabId: number) => panel.evaluate(async (id) => (await chrome.storage.session.get(`tabConversation:${id}`))[`tabConversation:${id}`] as string | undefined, tabId);
    const conversation = await linked(await tabIdOf(context, site));
    expect(conversation).toBeTruthy();

    // A tab of the user's own, with nothing to do with the task…
    const other = await context.newPage();
    await other.goto(`${server.origin}/other.html`);
    const otherId = await tabIdOf(context, other);
    expect(await linked(otherId)).toBeUndefined();
    // …dragged into the group: it shows the same conversation.
    await panel.evaluate(
      async ({ from, tab }) => {
        const [grouped] = (await chrome.tabs.query({})).filter((t) => t.url === from);
        await chrome.tabs.group({ groupId: grouped!.groupId, tabIds: [tab] });
      },
      { from: site.url(), tab: otherId },
    );
    await expect.poll(() => linked(otherId)).toBe(conversation);
    await other.bringToFront();
    await panel.bringToFront();
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Pressed it.');

    // A tab in a group of the user's own is left alone.
    const third = await context.newPage();
    await third.goto(`${server.origin}/third.html`);
    const thirdId = await tabIdOf(context, third);
    await panel.evaluate(async (tab) => {
      const groupId = await chrome.tabs.group({ tabIds: [tab] });
      await chrome.tabGroups.update(groupId, { title: 'Holiday' });
    }, thirdId);
    await panel.waitForTimeout(500);
    expect(await linked(thirdId)).toBeUndefined();
    await third.close();
    await other.close();
    await site.close();
    await panel.close();
  });

  test('on a forum the assistant reads: a few pages, in the tab, and a vote waits for the user', async () => {
    const forum = `http://www.smzdm.com:${new URL(server.origin).port}`;
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${forum}/forum/thread-1.html`);
    await ask(panel, 'SK-FORUM what do owners report?');
    // Auto mode, and still asked: the vote would be cast in the user's name.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('acts in your name on a social site', { timeout: 60_000 });
    await screenshot(panel, 'feature-social-approval');
    // It can be allowed once or for this task; a standing permission to act in the user's name on the site is not offered.
    await expect(approval.getByRole('button', { name: /Always allow on this site/ })).toHaveCount(0);
    await approval.getByRole('button', { name: /Deny/ }).click();
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Ninth page: refused. In the background: refused. Vote: not cast.', { timeout: 30_000 });
    // Eight pages were looked at, in the tab; the ninth and the tenth were never requested.
    expect(site.url()).toBe(`${forum}/forum/thread-8.html`);
    expect(server.hits.filter((hit) => /^\/forum\/thread-\d+\.html$/.test(hit)).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `/forum/thread-${i + 1}.html`).sort());
    await expect(site.locator('#votes')).toHaveText('0');
    // The model was told when the limit was reached.
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('You have looked at 8 pages on smzdm.com in this request');
    await site.close();
    await panel.close();
  });

  test('which sites are forums, and how many pages a request looks at, are the user\'s to change', async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#sites`);
    const card = options.getByTestId('social-sites');
    const sites = card.getByTestId('social-site');
    await expect(sites).toHaveCount(28);
    await expect(card.locator('#social-pages')).toHaveValue('8');
    await expect(card.getByTestId('social-restore')).toHaveCount(0);

    // A forum of the user's own goes on the list, however it is typed; one that came with the extension is taken off.
    await card.getByTestId('social-new').fill('https://www.MyForum.test/threads');
    await card.getByTestId('social-add').click();
    await expect(sites).toHaveCount(29);
    await expect(card).toContainText('myforum.test');
    await card.getByRole('button', { name: 'Delete smzdm.com' }).click();
    await expect(sites).toHaveCount(28);
    await card.locator('#social-pages').fill('2');
    await card.locator('#social-pages').blur();
    const stored = () => options.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1'].social);
    await expect.poll(stored).toEqual({ added: ['myforum.test'], removed: ['smzdm.com'], pages: 2 });
    // Out of range is brought back into it.
    await card.locator('#social-pages').fill('5000');
    await card.locator('#social-pages').blur();
    await expect(card.locator('#social-pages')).toHaveValue('100');
    await card.locator('#social-pages').fill('2');
    await card.locator('#social-pages').blur();
    await expect.poll(async () => (await stored()).pages).toBe(2);
    await screenshot(options, 'feature-social-settings');

    // On the user's forum the rules hold, with their number: the third page is refused, and it is not read in the background.
    const port = new URL(server.origin).port;
    const own = await openSiteAndPanel(context, extensionId, `http://bbs.myforum.test:${port}/forum/thread-1.html`);
    await ask(own.panel, 'SK-OWN what do owners report?');
    await expect(own.panel.getByTestId('assistant-message').last()).toContainText('Third page: refused. In the background: refused.', { timeout: 60_000 });
    expect(own.site.url()).toBe(`http://bbs.myforum.test:${port}/forum/thread-2.html`);
    await own.site.close();
    await own.panel.close();

    // The site taken off the list is an ordinary site again: its page is read in the background like any other.
    const plain = await openSiteAndPanel(context, extensionId, `http://www.smzdm.com:${port}/forum/thread-1.html`);
    await ask(plain.panel, 'SK-OWN and here?');
    await expect(plain.panel.getByTestId('assistant-message').last()).toContainText('Third page: opened. In the background: read.', { timeout: 60_000 });
    await plain.site.close();
    await plain.panel.close();

    // Back to how it came.
    await options.bringToFront();
    await card.getByTestId('social-restore').click();
    await expect(sites).toHaveCount(28);
    await expect(card.locator('#social-pages')).toHaveValue('8');
    await expect.poll(stored).toEqual({ added: [], removed: [], pages: 8 });
    await options.close();
  });
});
