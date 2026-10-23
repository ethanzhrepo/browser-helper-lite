import { expect, test, type BrowserContext } from '@playwright/test';
import { ask, launch, openSiteAndPanel, screenshot, seed } from './helpers';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;

test.describe.serial('second-round hardening', () => {
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

  test('on a sensitive page every change waits, and an approval does not carry over to a swapped button', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/settings/security`);
    await ask(panel, 'TEST-SWAP: save my security settings');

    // Auto mode, yet the click waits: this is an account-security page. Only one-off approval is offered.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('account security', { timeout: 20_000 });
    await expect(approval).toContainText('Save');
    await expect(approval.getByRole('button', { name: 'Allow for this task' })).toHaveCount(0);
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toHaveCount(0);
    await screenshot(panel, 'hardening-sensitive-page');

    // While the user reads the card, the page turns the button into something else.
    await site.evaluate(() => {
      document.getElementById('save')!.textContent = 'Delete account';
    });
    await approval.getByRole('button', { name: 'Allow once' }).click();

    // The approval was for "Save": nothing is clicked, and the new button needs its own (high-risk) approval.
    await expect(approval).toContainText('High-risk action', { timeout: 20_000 });
    await expect(approval).toContainText('Delete account');
    await expect(site.locator('#saved')).toHaveText('0');
    await approval.getByRole('button', { name: 'Deny' }).click();

    const run = panel.getByTestId('agent-run');
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(panel.getByTestId('assistant-message').last()).toContainText('Nothing was changed');
    await expect(site.locator('#saved')).toHaveText('0');
    await expect(panel.locator('[data-testid="agent-action"][data-status="rejected"]')).toHaveCount(2);
  });

  test('card numbers and keys never reach the model, and cannot be searched for', async () => {
    const { panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/secret.html`);
    await ask(panel, 'TEST-SECRET: what is on this page?');
    const run = panel.getByTestId('agent-run');
    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 20_000 });

    const sent = JSON.stringify(server.chatRequests.flatMap((r) => r.messages).filter((m) => m.role === 'tool'));
    expect(sent).toContain('[card number hidden]');
    expect(sent).toContain('[key or token hidden]');
    for (const secret of ['4111 1111 1111 1111', '5555 5555 5555 4444', 'sk-proj-AbCdEf', 'value=\\"123\\"']) {
      expect(sent, secret).not.toContain(secret);
    }
    // The search was refused before it left the browser.
    await expect(panel.locator('[data-testid="agent-action"][data-status="error"]')).toHaveCount(1);
    expect(sent).toContain('Search queries must not contain keys, tokens or card numbers');
    expect(server.hits.some((path) => path.startsWith('/search'))).toBe(false);
  });

  test('a reply link that carries data shows its address before it opens', async () => {
    const { panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/review.html`);
    await ask(panel, 'TEST-LINK: where do I confirm?');
    const reply = panel.getByTestId('assistant-message').last();
    const link = reply.getByTestId('data-link');
    await expect(link).toHaveText('confirm your subscription', { timeout: 20_000 });
    await expect(reply.getByRole('link', { name: 'guide' })).not.toHaveAttribute('data-testid', 'data-link');

    const pages = context.pages().length;
    await link.click();
    await expect(reply.getByTestId('data-link-warning')).toContainText('collect?e=victim@example.com');
    await screenshot(panel, 'hardening-data-link');
    expect(context.pages().length).toBe(pages);
    expect(server.hits.some((path) => path.startsWith('/collect'))).toBe(false);
  });
});
