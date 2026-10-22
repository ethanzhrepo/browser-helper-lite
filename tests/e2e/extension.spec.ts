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
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

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
});

test.afterAll(async () => {
  await context?.close();
  await server?.close();
});

test('connect a provider, attach page context and stream a reply', async () => {
  // 1. Add an OpenAI-compatible connection in the options page.
  const options = await context.newPage();
  await options.setViewportSize({ width: 1100, height: 820 });
  await options.goto(`chrome-extension://${extensionId}/options.html#providers`);
  await options.getByLabel('Provider').selectOption('openai-compatible');
  await options.getByLabel('Service').selectOption('custom');
  await options.getByLabel('Name', { exact: true }).fill('Mock provider');
  await options.getByLabel('Base URL').fill(`${server.origin}/v1`);

  const keyInput = options.getByLabel('API key (optional)');
  await keyInput.fill('wrong-key');
  await options.getByRole('button', { name: 'Test connection' }).click();
  await expect(options.getByText('The API key was rejected')).toBeVisible();

  await keyInput.fill(MOCK_KEY);
  await options.getByRole('button', { name: 'Test connection' }).click();
  await expect(options.getByText('Connected. Found 1 model.')).toBeVisible();
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.getByText('Mock provider')).toBeVisible();
  await expect(options.getByText('1 model', { exact: true })).toBeVisible();
  await screenshot(options, 'options-providers');

  // The first connection becomes the chat model automatically.
  await options.goto(`chrome-extension://${extensionId}/options.html#models`);
  await expect(options.locator('#model-chat')).toHaveValue(MOCK_MODEL);

  // 2. Open a web page and select some text on it.
  const site = await context.newPage();
  await site.goto(`${server.origin}/page.html`);
  await site.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('selectable')!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });

  // 3. The panel, opened as a tab, targets the most recently used other tab.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 760 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByTestId('page-chip')).toContainText('Mobile Plans Test');
  await expect(panel.getByRole('button', { name: MOCK_MODEL })).toBeVisible();
  await screenshot(panel, 'sidepanel-empty');

  await panel.getByTestId('page-chip').click();
  await expect(panel.getByTestId('page-chip')).toHaveAttribute('aria-pressed', 'true');
  const input = panel.getByTestId('composer-input');
  await input.fill('Which plan includes US roaming?');
  await input.press('Enter');

  const reply = panel.getByTestId('assistant-message').last();
  await expect(reply).toContainText('includes US roaming.');
  await expect(reply.locator('table')).toBeVisible();

  const request = server.chatRequests.at(-1)!;
  expect(request.model).toBe(MOCK_MODEL);
  expect(request.stream).toBe(true);
  expect(request.messages[0]).toMatchObject({ role: 'system' });
  expect(request.messages[0]!.content).toContain('untrusted data');
  const userTurn = request.messages.at(-1)!;
  expect(userTurn.content).toContain('<context type="page" title="Mobile Plans Test"');
  expect(userTurn.content).toContain('Plan B costs $65 per month');
  expect(userTurn.content).toMatch(/Which plan includes US roaming\?$/);
  await expect(panel.getByTestId('user-message').last()).toContainText('Mobile Plans Test');
  await screenshot(panel, 'sidepanel-reply');

  // 4. Slash commands and @selection.
  await input.fill('/');
  for (const label of ['Summarize', 'Translate', 'Explain', 'Extract tables']) {
    await expect(panel.getByRole('option', { name: new RegExp(label) })).toBeVisible();
  }
  await input.fill('@sel');
  await input.press('Enter');
  await expect(panel.getByText(/“Roaming in the US is included with Plan…”/)).toBeVisible();
  await input.fill('What does this mean?');
  await input.press('Enter');
  await expect(panel.getByTestId('assistant-message')).toHaveCount(2);
  await expect(panel.getByTestId('assistant-message').last()).toContainText('includes US roaming.');
  const selectionTurn = server.chatRequests.at(-1)!.messages.at(-1)!;
  expect(selectionTurn.content).toContain('<context type="selection"');
  expect(selectionTurn.content).toContain('Roaming in the US is included with Plan B.');
  // History is resent, so the first question is part of the second request.
  expect(server.chatRequests.at(-1)!.messages.filter((m) => m.role === 'user')).toHaveLength(2);

  // 5. New chat, then reopen the conversation from history.
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('How can I help with this page?')).toBeVisible();
  await panel.getByRole('button', { name: 'History' }).click();
  await panel.getByRole('button', { name: /Which plan includes US roaming\?/ }).click();
  await expect(panel.getByTestId('user-message')).toHaveCount(2);

  // 6. Switching the language in settings updates the open panel live.
  await options.goto(`chrome-extension://${extensionId}/options.html#language`);
  await options.getByLabel('简体中文').check();
  await expect(panel.getByTestId('composer-input')).toHaveAttribute('placeholder', '有什么想问的…');
  await screenshot(panel, 'sidepanel-zh');
  await panel.emulateMedia({ colorScheme: 'dark' });
  await screenshot(panel, 'sidepanel-zh-dark');
  await screenshot(options, 'options-language-zh');
});
