import { expect, test, type BrowserContext } from '@playwright/test';
import { ask, chooseMode, groupOf, launch, openSiteAndPanel, screenshot, seed } from './helpers';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;

const settingsFor = (origin: string, agent: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  connections: [
    {
      id: 'mock',
      vendor: 'openai-compatible',
      presetId: 'custom',
      name: 'Mock provider',
      baseURL: `${origin}/v1`,
      models: [MOCK_MODEL, 'mock-vision'],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  slots: { chat: { connectionId: 'mock', modelId: MOCK_MODEL }, vision: { connectionId: 'mock', modelId: 'mock-vision' } },
  agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: true, ...agent },
  search: { provider: 'browser', engine: 'custom', customUrl: `${origin}/search?q=%s`, cloudflare: { accountId: '', gatewayId: 'default', source: 'ceramic' }, fallbackToBrowser: true },
  ...extra,
});

async function startTurn(panel: import('@playwright/test').Page, request: string) {
  await ask(panel, request);
  await expect(panel.getByTestId('agent-run')).toBeVisible({ timeout: 20_000 });
}

test.describe.serial('assistant operating pages', () => {
  test.beforeAll(async () => {
    server = await startMockServer();
    ({ context, extensionId } = await launch());
    await seed(context, extensionId, settingsFor(server.origin, {}), { mock: MOCK_KEY });
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('shop in Manual mode: search, type, extract, look, approve adding to cart, tab group', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await expect(panel.getByTestId('page-chip')).toContainText('Test Shop');
    await expect(panel.getByTestId('mode-picker')).toHaveAttribute('data-mode', 'auto');
    await chooseMode(panel, 'manual');
    await screenshot(panel, 'agent-empty');
    await startTurn(panel, 'TEST-SHOP: add the cheapest braided USB-C cable to my cart');

    // Manual mode: typing into the search box runs, adding to the cart waits for approval.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toBeVisible({ timeout: 30_000 });
    await expect(approval).toContainText('Add Cable B to cart');
    await expect(approval).toContainText('Submits, sends or saves something.');
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toBeVisible();
    await screenshot(panel, 'agent-approval');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await screenshot(panel, 'agent-approval-dark');
    await panel.emulateMedia({ colorScheme: 'light' });
    await expect(site.locator('browser-helper-overlay')).toHaveCount(1);
    await screenshot(site, 'agent-overlay');
    // While the turn waits for the user, its tab group turns yellow.
    expect(await groupOf(panel, site.url())).toEqual({ title: 'Browser Helper', color: 'yellow' });
    await approval.getByRole('button', { name: 'Allow once' }).click();

    const run = panel.getByTestId('agent-run');
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Added Cable B ($5.49) to the cart.');
    await expect(panel.getByTestId('assistant-message').last().locator('table')).toBeVisible();
    await expect(site.locator('#cart')).toHaveText('Cart: 1 item');
    await expect(site.locator('browser-helper-overlay')).toHaveCount(0);
    expect(await groupOf(panel, site.url())).toEqual({ title: 'Browser Helper', color: 'grey' });

    // The finished run says what it did in a few words; the steps (type, click, look…) show only when asked for.
    await expect(run.getByTestId('run-activity')).toHaveText('1 search · 1 site');
    await expect(run.getByTestId('run-details')).toContainText('Finished');
    await expect(run.getByTestId('run-elapsed')).toHaveCount(0);
    await expect(run.getByTestId('run-steps')).toBeHidden();
    await run.getByTestId('run-details').click();
    for (const tool of ['web_search', 'view_page', 'type', 'extract', 'look', 'click']) {
      await expect(run.locator(`[data-testid="agent-action"][data-tool="${tool}"][data-status="done"]`).first()).toBeVisible();
    }
    await run.getByTestId('run-details').click();
    await expect(run.getByTestId('run-steps')).toBeHidden();
    // Search results and page views reach the model; older views are pruned.
    const last = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(last).toContain('USB-C cable buying guide');
    expect(last).toContain('Older page view removed');
    expect(last.match(/<page_view id=/g)).toHaveLength(1);
    expect(server.chatRequests.at(-1)!.tools?.map((t) => t.function.name)).toContain('read_page');
    // The results page is short: "extract" hands it over whole instead of asking a second model about it.
    expect(server.extractRequests).toHaveLength(0);
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('The page is short, so here is all of it');
    const image = server.lookRequests[0]?.messages[0]?.content;
    expect(Array.isArray(image) && image.some((p) => (p.image_url?.url.length ?? 0) > 1000)).toBe(true);
    console.log('driver used:', await run.getByTestId('driver-badge').textContent());
    await screenshot(panel, 'agent-shop-done');

    // A new chat puts the tab back out of the group.
    await panel.getByRole('button', { name: 'New chat' }).click();
    await expect.poll(() => groupOf(panel, site.url())).toBeUndefined();
  });

  test('park in Auto mode: CAPTCHA hand-off, question, high-risk payment denied', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/park.html`);
    await chooseMode(panel, 'auto');
    await startTurn(panel, 'TEST-PARK: book a day pass');

    const handoff = panel.getByTestId('handoff-card');
    await expect(handoff).toBeVisible({ timeout: 20_000 });
    await expect(handoff).toContainText('Please solve the verification');
    await screenshot(panel, 'agent-handoff');
    // The user solves it in the page; the turn resumes by itself.
    await site.click('#robot');

    await expect(panel.getByTestId('question-card')).toContainText('Which date would you like', { timeout: 20_000 });
    await expect(panel.getByTestId('composer-input')).toHaveAttribute('placeholder', "Type your answer…");
    await panel.getByTestId('composer-input').fill('Nov 3');
    await panel.getByTestId('composer-input').press('Enter');

    // Auto mode runs the select and the click; paying is high risk.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('High-risk action', { timeout: 30_000 });
    await expect(approval).toContainText('Pay now');
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toHaveCount(0);
    await screenshot(panel, 'agent-high-risk');
    await approval.getByRole('button', { name: 'Deny' }).click();

    await expect(panel.getByTestId('agent-run')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Your day pass for Nov 3 costs $25');
    await expect(site.locator('#chosen')).toHaveText('Nov 3');
    await expect(site.locator('#paid')).toBeHidden();
    await expect(panel.locator('[data-testid="agent-action"][data-status="rejected"]')).toHaveCount(1);
  });

  test('Query mode refuses to press buttons', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await chooseMode(panel, 'query');
    await startTurn(panel, 'TEST-QUERY: search the shop');
    await expect(panel.getByTestId('agent-run')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.locator('[data-testid="agent-action"][data-tool="click"]')).toHaveAttribute('data-status', 'rejected');
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Query mode is on');
    await expect(site.locator('#results')).toBeEmpty();
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('Query mode is on: you may read');
    await chooseMode(panel, 'auto');
  });

  test('pauses when the user uses the page, resumes, and stops', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await startTurn(panel, 'TEST-STOP: keep waiting');
    const run = panel.getByTestId('agent-run');
    await expect(run.locator('[data-tool="wait"]').first()).toBeAttached({ timeout: 20_000 });
    // "Wait 1 s" is not shown: the run says which site it is working on.
    await expect(run.locator('[data-tool="wait"]').first()).toBeHidden();
    await expect(run.getByTestId('run-activity')).toHaveText(/^Working on /);
    // While it works, the line is what it is doing, with how long it has been at it; "Working" alone is not shown.
    await expect(run.getByTestId('run-details')).not.toContainText(/Working(?! on)/);
    await expect(run.getByTestId('run-elapsed')).toHaveText(/^\d+:\d\d$/);

    // A click on empty space leaves the page as it is, and the assistant at work (see features.spec.ts for more of these).
    await site.mouse.click(400, 300);
    await site.waitForTimeout(600);
    await expect(run).toHaveAttribute('data-status', 'running');
    // A click into the search field takes the page over.
    await site.getByPlaceholder('Search products').click();
    await expect(run).toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
    await expect(run).toContainText('Paused because you used the page');

    await panel.getByTestId('agent-controls').getByRole('button', { name: 'Resume' }).click();
    await expect(run).toHaveAttribute('data-status', 'running');
    await panel.getByTestId('agent-controls').getByRole('button', { name: 'Stop' }).click();
    await expect(run).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 });
    await expect(panel.getByTestId('assistant-message').last()).toContainText('The task was stopped.');
    await expect(panel.getByTestId('agent-controls')).toHaveCount(0);
  });
});

test.describe.serial('assistant with the DOM driver', () => {
  test.beforeAll(async () => {
    server = await startMockServer();
    ({ context, extensionId } = await launch());
    await seed(
      context,
      extensionId,
      settingsFor(server.origin, { mode: 'manual', useCdp: false, notifications: false }, { sitePolicies: { '127.0.0.1': 'auto' } }),
      { mock: MOCK_KEY },
    );
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('a site marked automatic skips Manual approvals; input uses simulated events', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await expect(panel.getByTestId('mode-picker')).toHaveAttribute('data-mode', 'manual');
    await startTurn(panel, 'TEST-SHOP: add the cheapest braided USB-C cable to my cart');
    const run = panel.getByTestId('agent-run');
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    await expect(run.getByTestId('driver-badge')).toHaveText('dom');
    await expect(site.locator('#cart')).toHaveText('Cart: 1 item');
  });

  test('searching on and on without reading is stopped after six searches, until a page is read', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await chooseMode(panel, 'auto');
    const before = server.hits.filter((hit) => hit.startsWith('/search?')).length;
    await ask(panel, 'TEST-SEARCHES: find a cable guide');
    // Six searches went out, the seventh and eighth did not; after a page was read, the next one did.
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Searches refused: 2. After reading: searched.', { timeout: 60_000 });
    expect(server.hits.filter((hit) => hit.startsWith('/search?')).length - before).toBe(7);
    await site.close();
    await panel.close();
  });

  test('the assistant works behind the tab the user is looking at; its tabs come to the front only for a user who follows it', async () => {
    /** Counts the tabs that come to the front from now on, and says which one is there. */
    const watchFront = async (panel: import('@playwright/test').Page) => {
      await panel.evaluate(() => {
        const scope = window as unknown as { activated: number[] };
        scope.activated = [];
        chrome.tabs.onActivated.addListener(({ tabId }) => void scope.activated.push(tabId));
      });
      return {
        activated: () => panel.evaluate(() => (window as unknown as { activated: number[] }).activated.length),
        front: () => panel.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url ?? ''),
      };
    };

    // The user is on another tab (here the panel's own page): a search, a new tab and reading it all happen behind it.
    const away = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await chooseMode(away.panel, 'auto');
    const elsewhere = await watchFront(away.panel);
    await ask(away.panel, 'TEST-TABS: what does the guide say?');
    await expect(away.panel.getByTestId('assistant-message').last()).toContainText('The guide says: Braided cables last longer.', { timeout: 30_000 });
    expect(await elsewhere.activated()).toBe(0);
    expect(await elsewhere.front()).toContain('chrome-extension://');
    for (const page of context.pages()) if (page.url().includes('/review.html')) await page.close();
    await away.site.close();
    await away.panel.close();

    // The user is looking at the assistant's tab: the tab it opens comes to the front, and the search tab does not.
    const near = await openSiteAndPanel(context, extensionId, `${server.origin}/shop.html`);
    await near.site.bringToFront();
    const following = await watchFront(near.panel);
    await ask(near.panel, 'TEST-TABS: what does the guide say?');
    await expect(near.panel.getByTestId('assistant-message').last()).toContainText('The guide says: Braided cables last longer.', { timeout: 30_000 });
    expect(await following.front()).toBe(`${server.origin}/review.html`);
    expect(await following.activated()).toBe(1);
    for (const page of context.pages()) if (page.url().includes('/review.html')) await page.close();
    await near.site.close();
    await near.panel.close();
  });
});
