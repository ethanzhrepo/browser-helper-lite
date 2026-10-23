import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ask, launch, openPanel, screenshot, seed } from './helpers';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;
let panel: Page;

/** Makes `site` the panel's tab: the panel, opened as a tab, follows the most recently used other tab. */
async function focus(site: Page) {
  await site.bringToFront();
  await panel.bringToFront();
}

const userMessages = () => panel.getByTestId('user-message');

test.describe.serial('one chat per tab', () => {
  test.beforeAll(async () => {
    server = await startMockServer();
    ({ context, extensionId } = await launch());
    await seed(
      context,
      extensionId,
      {
        connections: [
          { id: 'mock', vendor: 'openai-compatible', presetId: 'custom', name: 'Mock provider', baseURL: `${server.origin}/v1`, models: [MOCK_MODEL], createdAt: 1, updatedAt: 1 },
        ],
        slots: { chat: { connectionId: 'mock', modelId: MOCK_MODEL } },
        agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: false },
      },
      { mock: MOCK_KEY },
    );
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('each tab keeps its own conversation; pinning keeps one across tabs', async () => {
    const plans = await context.newPage();
    await plans.goto(`${server.origin}/page.html`);
    const shop = await context.newPage();
    await shop.goto(`${server.origin}/shop.html`);
    panel = await openPanel(context, extensionId);

    await focus(plans);
    await expect(panel.getByTestId('page-chip')).toContainText('Mobile Plans Test');
    await ask(panel, 'Hello from tab one');
    await expect(panel.getByTestId('assistant-message').last()).toContainText('includes US roaming.');

    // Another tab starts with its own, empty chat.
    await focus(shop);
    await expect(panel.getByTestId('page-chip')).toContainText('Test Shop');
    await expect(panel.getByTestId('empty-state')).toBeVisible();
    await expect(userMessages()).toHaveCount(0);
    await panel.getByTestId('composer-input').fill('half-typed on the shop');
    await screenshot(panel, 'tabs-new-tab');

    // Back on the first tab, its conversation (and an empty draft) come back.
    await focus(plans);
    await expect(userMessages()).toHaveText(['Hello from tab one']);
    await expect(panel.getByTestId('composer-input')).toHaveValue('');

    await focus(shop);
    await expect(panel.getByTestId('composer-input')).toHaveValue('half-typed on the shop');
    await ask(panel, 'Hello from tab two');
    await expect(userMessages()).toHaveText(['Hello from tab two']);
    await expect(panel.getByTestId('assistant-message').last()).toContainText('includes US roaming.');

    // A pinned chat stays while switching tabs; unpinning goes back to the tab's own chat.
    await focus(plans);
    await expect(userMessages()).toHaveText(['Hello from tab one']);
    await panel.getByTestId('pin-chat').click();
    await expect(panel.getByTestId('pin-chat')).toHaveAttribute('aria-pressed', 'true');
    await focus(shop);
    await expect(panel.getByTestId('page-chip')).toContainText('Test Shop');
    await expect(userMessages()).toHaveText(['Hello from tab one']);
    await panel.getByTestId('pin-chat').click();
    await expect(userMessages()).toHaveText(['Hello from tab two']);
  });

  test('@ attaches another tab', async () => {
    const plans = context.pages().find((p) => p.url().endsWith('/page.html'))!;
    await focus(plans);
    await expect(userMessages()).toHaveText(['Hello from tab one']);
    const input = panel.getByTestId('composer-input');
    await input.fill('@shop');
    await expect(panel.getByText('Other tabs')).toBeVisible();
    await screenshot(panel, 'tabs-mention');
    await input.press('Enter');
    await expect(panel.getByTestId('tab-context-chip')).toContainText('Test Shop');
    await input.fill('Compare the two pages');
    await input.press('Enter');
    await expect(panel.getByTestId('assistant-message')).toHaveCount(2);
    await expect(panel.getByTestId('assistant-message').last()).toContainText('includes US roaming.');
    const last = server.chatRequests.at(-1)!.messages.at(-1)!;
    expect(last.content).toContain('<context type="page" title="Test Shop"');
    expect(last.content).toContain('Compare the two pages');
  });

  test('tabs the assistant opens show the same conversation', async () => {
    const plans = context.pages().find((p) => p.url().endsWith('/page.html'))!;
    await focus(plans);
    await panel.getByRole('button', { name: 'New chat' }).click();
    await expect(panel.getByTestId('empty-state')).toBeVisible();
    const opened = context.waitForEvent('page');
    await ask(panel, 'TEST-OPEN: open the cable guide');
    const guide = await opened;
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Opened the cable guide', { timeout: 20_000 });

    await focus(guide);
    await expect(panel.getByTestId('page-chip')).toContainText('Guide');
    await expect(userMessages()).toHaveText(['TEST-OPEN: open the cable guide']);
  });

  test('a turn in another tab is shown in a bar, with a way back', async () => {
    const plans = context.pages().find((p) => p.url().endsWith('/page.html'))!;
    const shop = context.pages().find((p) => p.url().endsWith('/shop.html'))!;
    await focus(shop);
    await panel.getByRole('button', { name: 'New chat' }).click();
    await ask(panel, 'TEST-STOP: keep waiting');
    await expect(panel.getByTestId('agent-run')).toBeVisible({ timeout: 20_000 });

    await focus(plans);
    const bar = panel.getByTestId('other-task');
    await expect(bar).toContainText('Working in another tab: TEST-STOP: keep waiting');
    await screenshot(panel, 'tabs-other-task');
    await bar.click();
    // "Show" brings the task's tab to the front; the panel shows its conversation.
    await expect.poll(() => shop.evaluate(() => document.visibilityState)).toBe('visible');
    await panel.bringToFront();
    await expect(panel.getByTestId('agent-run')).toBeVisible();
    await expect(userMessages()).toHaveText(['TEST-STOP: keep waiting']);
    await expect(panel.getByTestId('other-task')).toHaveCount(0);
    await panel.getByTestId('stop-button').click();
    await expect(panel.getByTestId('agent-run')).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 });
  });
});
