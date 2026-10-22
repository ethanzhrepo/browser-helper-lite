import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

const EXTENSION_PATH = path.resolve('.output-e2e/chrome-mv3');
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;

async function screenshot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Let fade-in and color transitions finish.
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

/** Opens a site, then the panel as a tab; the panel targets the site (its most recent other tab). */
async function openSiteAndPanel(url: string): Promise<{ site: Page; panel: Page }> {
  const site = await context.newPage();
  await site.goto(url);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByTestId('mode-act').click();
  return { site, panel };
}

async function startTask(panel: Page, goal: string) {
  const input = panel.getByTestId('composer-input');
  await input.fill(goal);
  await input.press('Enter');
  await expect(panel.getByTestId('agent-run')).toBeVisible();
}

test.describe.serial('agent', () => {
  test.beforeAll(async () => {
    server = await startMockServer();
    context = await chromium.launchPersistentContext('', {
      headless: true,
      executablePath: CHROMIUM,
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;

    // Seed a mock connection, chat + vision models and a custom search engine.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(
      async ({ origin, key, model }) => {
        const connection = {
          id: 'mock',
          vendor: 'openai-compatible',
          presetId: 'custom',
          name: 'Mock provider',
          baseURL: `${origin}/v1`,
          models: [model, 'mock-vision'],
          createdAt: 1,
          updatedAt: 1,
        };
        await chrome.storage.local.set({
          'settings:v1': {
            schemaVersion: 1,
            connections: [connection],
            slots: { chat: { connectionId: 'mock', modelId: model }, vision: { connectionId: 'mock', modelId: 'mock-vision' } },
            language: 'auto',
            agent: { useCdp: true, maxSteps: 20, notifications: true, searchEngine: 'custom', customSearchUrl: `${origin}/search?q=%s` },
            sitePolicies: {},
            updatedAt: 1,
          },
          'secrets:v1': { mock: key },
        });
      },
      { origin: server.origin, key: MOCK_KEY, model: MOCK_MODEL },
    );
    await options.close();
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('shop: search the web, type, extract, look, approve adding to cart', async () => {
    const { site, panel } = await openSiteAndPanel(`${server.origin}/shop.html`);
    await expect(panel.getByTestId('target-chip')).toContainText('Test Shop');
    await screenshot(panel, 'agent-empty');
    await startTask(panel, 'TEST-SHOP: add the cheapest braided USB-C cable to my cart');

    // "Add to cart" is an effect (risk 2): the agent waits for approval.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toBeVisible({ timeout: 30_000 });
    await expect(approval).toContainText('Add Cable B to cart');
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toBeVisible();
    await screenshot(panel, 'agent-approval');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await screenshot(panel, 'agent-approval-dark');
    await panel.emulateMedia({ colorScheme: 'light' });
    await expect(site.locator('browser-helper-overlay')).toHaveCount(1);
    await screenshot(site, 'agent-overlay');
    await approval.getByRole('button', { name: 'Allow once' }).click();

    const run = panel.getByTestId('agent-run');
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Added Cable B ($5.49) to the cart.');
    await expect(site.locator('#cart')).toHaveText('Cart: 1 item');
    // The overlay is removed when the task ends.
    await expect(site.locator('browser-helper-overlay')).toHaveCount(0);

    for (const tool of ['web_search', 'type', 'extract', 'look', 'click', 'done']) {
      await expect(run.locator(`[data-testid="agent-action"][data-tool="${tool}"][data-status="done"]`).first()).toBeVisible();
    }
    const searchStep = server.agentRequests.find((r) => JSON.stringify(r.messages).includes('USB-C cable buying guide'));
    expect(searchStep, 'search results reach the agent').toBeDefined();
    expect(JSON.stringify(server.extractRequests[0]?.messages)).toContain('Cable B');
    const image = server.lookRequests[0]?.messages[0]?.content;
    expect(Array.isArray(image) && image.some((p) => (p.image_url?.url.length ?? 0) > 1000)).toBe(true);
    console.log('driver used:', await run.getByTestId('driver-badge').textContent());
    await screenshot(panel, 'agent-shop-done');
  });

  test('park: CAPTCHA hand-off, question, high-risk payment denied', async () => {
    const { site, panel } = await openSiteAndPanel(`${server.origin}/park.html`);
    await startTask(panel, 'TEST-PARK: book a day pass');

    const handoff = panel.getByTestId('handoff-card');
    await expect(handoff).toBeVisible({ timeout: 20_000 });
    await expect(handoff).toContainText('Please solve the verification');
    await screenshot(panel, 'agent-handoff');
    // The user solves it in the page; the task resumes by itself.
    await site.click('#robot');

    await expect(panel.getByTestId('question-card')).toContainText('Which date would you like', { timeout: 20_000 });
    await expect(panel.getByTestId('composer-input')).toHaveAttribute('placeholder', "Answer the agent's question…");
    await panel.getByTestId('composer-input').fill('Nov 3');
    await panel.getByTestId('composer-input').press('Enter');

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

  test('pauses when the user uses the page, resumes, and stops', async () => {
    const { site, panel } = await openSiteAndPanel(`${server.origin}/shop.html`);
    await startTask(panel, 'TEST-STOP: keep waiting');
    const run = panel.getByTestId('agent-run');
    await expect(run.locator('[data-tool="wait"]').first()).toBeVisible({ timeout: 20_000 });

    await site.mouse.click(400, 300);
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

test.describe.serial('agent with the DOM driver', () => {
  test.beforeAll(async () => {
    server = await startMockServer();
    context = await chromium.launchPersistentContext('', {
      headless: true,
      executablePath: CHROMIUM,
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(
      async ({ origin, key, model }) => {
        await chrome.storage.local.set({
          'settings:v1': {
            schemaVersion: 1,
            connections: [
              { id: 'mock', vendor: 'openai-compatible', presetId: 'custom', name: 'Mock', baseURL: `${origin}/v1`, models: [model], createdAt: 1, updatedAt: 1 },
            ],
            slots: { chat: { connectionId: 'mock', modelId: model }, vision: { connectionId: 'mock', modelId: 'mock-vision' } },
            language: 'auto',
            agent: { useCdp: false, maxSteps: 20, notifications: false, searchEngine: 'custom', customSearchUrl: `${origin}/search?q=%s` },
            sitePolicies: { '127.0.0.1': 'auto' },
            updatedAt: 1,
          },
          'secrets:v1': { mock: key },
        });
      },
      { origin: server.origin, key: MOCK_KEY, model: MOCK_MODEL },
    );
    await options.close();
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('completes the shop task with simulated events and an "auto" site policy', async () => {
    const { site, panel } = await openSiteAndPanel(`${server.origin}/shop.html`);
    await startTask(panel, 'TEST-SHOP: add the cheapest braided USB-C cable to my cart');
    const run = panel.getByTestId('agent-run');
    // The site policy is "auto", so adding to the cart (risk 2) needs no approval.
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    await expect(run.getByTestId('driver-badge')).toHaveText('dom');
    await expect(site.locator('#cart')).toHaveText('Cart: 1 item');
  });
});
