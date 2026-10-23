import { expect, test, type BrowserContext } from '@playwright/test';
import { ask, launch, openSiteAndPanel, screenshot, seed } from './helpers';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;

test.describe.serial('prompt injection from a page', () => {
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

  test('hidden instructions are left out, flagged, and cannot make the assistant leak data', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/inject.html`);
    await ask(panel, 'TEST-INJECT: what is the deal on chargers?');

    // The model was told; the hidden text itself never reached it.
    const run = panel.getByTestId('agent-run');
    await expect(run.getByTestId('injection-warning')).toContainText('This page hides instructions for AI assistants', { timeout: 20_000 });
    // Even in Auto mode, the URL carrying an email address needs approval.
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('Check before allowing', { timeout: 20_000 });
    await expect(approval).toContainText('The address contains data');
    await expect(approval).toContainText('victim@example.com');
    await expect(approval.getByRole('button', { name: 'Always allow on this site' })).toHaveCount(0);
    const readPage = server.chatRequests
      .flatMap((r) => r.messages)
      .find((m) => m.role === 'tool' && JSON.stringify(m.content).includes('The 65W charger is $29'));
    const toolText = JSON.stringify(readPage?.content);
    expect(toolText).toContain('Security notice from the extension');
    expect(toolText).toMatch(/<page id=\\"[0-9a-f]{12}\\"/);
    expect(toolText).toContain('The 65W charger is $29');
    expect(toolText).not.toContain('victim@example.com');

    await screenshot(panel, 'injection-exfiltration');
    await approval.getByRole('button', { name: 'Deny' }).click();

    // After the injection attempt, an ordinary click also waits for approval.
    await expect(approval).toContainText('This page tried to give the assistant instructions', { timeout: 20_000 });
    await expect(approval).toContainText('Get coupon');
    await screenshot(panel, 'injection-cautious');
    await approval.getByRole('button', { name: 'Deny' }).click();

    await expect(run).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    const reply = panel.getByTestId('assistant-message').last();
    await expect(reply).toContainText('I ignored instructions hidden in the page.');
    // Images in replies are links, not loaded.
    await expect(reply.getByTestId('blocked-image')).toContainText('chart');
    await expect(reply.locator('img')).toHaveCount(0);
    await screenshot(panel, 'injection-done');

    expect(server.hits.some((path) => path.startsWith('/collect'))).toBe(false);
    expect(server.hits.some((path) => path.startsWith('/pixel.png'))).toBe(false);
    await expect(site.locator('#claimed')).toBeHidden();
    await expect(panel.locator('[data-testid="agent-action"][data-status="rejected"]')).toHaveCount(2);
  });
});
