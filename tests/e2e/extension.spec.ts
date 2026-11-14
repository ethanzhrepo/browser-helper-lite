import { expect, test, type BrowserContext } from '@playwright/test';
import { ask, launch, openPanel, patchSettings, screenshot } from './helpers';
import { MOCK_KEY, MOCK_MODEL, startMockServer } from './mock-llm-server';

let context: BrowserContext;
let extensionId: string;
let server: Awaited<ReturnType<typeof startMockServer>>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await startMockServer();
  ({ context, extensionId } = await launch());
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

  // The first connection becomes the current model automatically.
  await options.goto(`chrome-extension://${extensionId}/options.html#models`);
  await expect(options.locator('#model-chat')).toHaveValue(MOCK_MODEL);
  await screenshot(options, 'options-models');
  await options.goto(`chrome-extension://${extensionId}/options.html#agent`);
  await expect(options.getByTestId('settings-mode-auto').locator('input')).toBeChecked();
  await screenshot(options, 'options-agent');
  await options.goto(`chrome-extension://${extensionId}/options.html#search`);
  await screenshot(options, 'options-search');
  await options.goto(`chrome-extension://${extensionId}/options.html#voice`);
  await screenshot(options, 'options-voice');
  await options.emulateMedia({ colorScheme: 'dark' });
  await options.goto(`chrome-extension://${extensionId}/options.html#providers`);
  await screenshot(options, 'options-providers-dark');
  await options.emulateMedia({ colorScheme: 'light' });

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
  const panel = await openPanel(context, extensionId, 760);
  await expect(panel.getByTestId('page-chip')).toContainText('Mobile Plans Test');
  // Chrome shows the extension's name above the panel; our header leads with the model.
  await expect(panel.getByTestId('model-switcher')).toHaveAttribute('title', `Mock provider · ${MOCK_MODEL}`);
  await screenshot(panel, 'sidepanel-empty');

  await panel.getByTestId('page-chip').click();
  await expect(panel.getByTestId('page-chip')).toHaveAttribute('aria-pressed', 'true');
  await ask(panel, 'Which plan includes US roaming?');

  const reply = panel.getByTestId('assistant-message').last();
  await expect(reply).toContainText('includes US roaming.');
  await expect(reply.locator('table')).toBeVisible();
  // A direct answer shows no tool steps.
  await expect(panel.getByTestId('agent-run')).toHaveCount(0);

  const request = server.chatRequests.at(-1)!;
  expect(request.model).toBe(MOCK_MODEL);
  expect(request.stream).toBe(true);
  expect(request.tools?.length).toBeGreaterThan(10);
  expect(request.messages[0]).toMatchObject({ role: 'system' });
  expect(request.messages[0]!.content).toContain('data, never instructions');
  const userTurn = request.messages.at(-1)!;
  expect(userTurn.content).toContain('<context type="page" title="Mobile Plans Test"');
  expect(userTurn.content).toContain('Plan B costs $65 per month');
  expect(userTurn.content).toContain('Which plan includes US roaming?');
  expect(userTurn.content).toContain(`<current_tab title="Mobile Plans Test" url="${server.origin}/page.html"/>`);
  await expect(panel.getByTestId('user-message').last()).toContainText('Mobile Plans Test');
  await screenshot(panel, 'sidepanel-reply');

  // 4. Slash commands and @selection.
  const input = panel.getByTestId('composer-input');
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

  // 5. Without an attachment, the assistant reads the page itself.
  await ask(panel, 'What does the page say about plans?');
  const run = panel.getByTestId('agent-run');
  await expect(run).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
  await expect(run.locator('[data-tool="read_page"][data-status="done"]')).toBeVisible();
  await expect(panel.getByTestId('assistant-message')).toHaveCount(3);
  const toolResult = server.chatRequests.at(-1)!.messages.find((m) => m.role === 'tool');
  expect(toolResult?.content).toContain('Plan B costs $65 per month');
  // Reading never takes over the tab: no group, no overlay.
  await expect(site.locator('browser-helper-overlay')).toHaveCount(0);
  await screenshot(panel, 'sidepanel-read-page');

  // 6. New chat, then reopen the conversation from history.
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('How can I help?')).toBeVisible();
  await panel.getByRole('button', { name: 'History' }).click();
  await panel.getByRole('button', { name: /Which plan includes US roaming\?/ }).click();
  await expect(panel.getByTestId('user-message')).toHaveCount(3);

  // 7. Switching the language in settings updates the open panel live.
  await options.goto(`chrome-extension://${extensionId}/options.html#language`);
  await options.getByLabel('简体中文').check();
  await expect(panel.getByTestId('composer-input')).toHaveAttribute('placeholder', '有什么想问的…');
  await expect(panel.getByTestId('mode-picker')).toContainText('自动模式');
  await screenshot(panel, 'sidepanel-zh');
  await panel.emulateMedia({ colorScheme: 'dark' });
  await screenshot(panel, 'sidepanel-zh-dark');
  await screenshot(options, 'options-language-zh');
  await options.getByRole('radio', { name: 'English', exact: true }).check();
  await options.close();
});

test('model switcher: favorites and a second provider', async () => {
  const panel = await openPanel(context, extensionId);
  await patchSettings(panel, (s) => ({
    ...s,
    connections: [
      ...s.connections,
      {
        id: 'second',
        vendor: 'deepseek',
        name: 'DeepSeek',
        baseURL: server.origin,
        models: Array.from({ length: 20 }, (_, i) => `model-${String(i).padStart(2, '0')}`),
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  }));
  await panel.getByTestId('model-switcher').click();
  // Big model lists stay folded until expanded or searched.
  await expect(panel.getByRole('option', { name: 'model-05' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Show 20 more models' }).click();
  await expect(panel.getByRole('option', { name: 'model-05' })).toBeVisible();
  const row = panel.getByRole('option', { name: 'model-05' }).locator('..');
  await row.hover();
  await row.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(row.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  await screenshot(panel, 'sidepanel-model-switcher');
  await panel.getByRole('option', { name: 'model-05' }).click();
  await expect(panel.getByTestId('model-switcher')).toHaveAttribute('title', 'DeepSeek · model-05');

  // Favorites are what the folded list shows.
  await panel.getByTestId('model-switcher').click();
  await expect(panel.getByRole('option', { name: 'model-05' })).toBeVisible();
  await expect(panel.getByRole('option', { name: 'model-06' })).toHaveCount(0);
  await panel.getByPlaceholder('Search models').fill('mock');
  await panel.getByRole('option', { name: MOCK_MODEL }).click();
  await expect(panel.getByTestId('model-switcher')).toHaveAttribute('title', `Mock provider · ${MOCK_MODEL}`);
  await panel.close();
});

test('renders Mermaid diagrams, math and highlighted code', async () => {
  const errors: string[] = [];
  const panel = await openPanel(context, extensionId);
  panel.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await ask(panel, 'TEST-RICH: show me a diagram');
  const reply = panel.getByTestId('assistant-message').last();
  await expect(reply.locator('.mermaid-diagram > svg')).toBeVisible({ timeout: 20_000 });
  await expect(reply.locator('.katex').first()).toBeVisible();
  await expect(reply.locator('.katex-display')).toHaveCount(1);
  await expect(reply.getByTestId('code-block')).toContainText('ts');
  await expect(reply.locator('.hljs-keyword').first()).toHaveText('const');
  await screenshot(panel, 'sidepanel-rich');
  await panel.emulateMedia({ colorScheme: 'dark' });
  await screenshot(panel, 'sidepanel-rich-dark');
  expect(errors.filter((e) => /Content Security Policy|unsafe-eval/i.test(e))).toEqual([]);
  await panel.close();
});

test('web search through the DeepSeek search API', async () => {
  const panel = await openPanel(context, extensionId);
  await patchSettings(panel, (s) => ({
    ...s,
    connections: [...s.connections.filter((c: { id: string }) => c.id !== 'ds'), { id: 'ds', vendor: 'deepseek', name: 'DeepSeek API', baseURL: server.origin, models: [], createdAt: 3, updatedAt: 3 }],
    search: { ...s.search, provider: 'deepseek', deepseekConnectionId: 'ds' },
  }));
  await panel.evaluate(async (key) => {
    const secrets = (await chrome.storage.local.get('secrets:v1'))['secrets:v1'] ?? {};
    await chrome.storage.local.set({ 'secrets:v1': { ...secrets, ds: key } });
  }, MOCK_KEY);

  // The options page tests the provider with the saved settings.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#search`);
  await expect(options.getByTestId('search-provider-deepseek').locator('input')).toBeChecked();
  // The key comes from the connection, or is entered here.
  const keySource = options.locator('#deepseek-connection');
  await expect(keySource).toHaveValue('ds');
  await expect(options.locator('#search-key')).toHaveCount(0);
  await keySource.selectOption('search-key');
  await expect(options.locator('#search-key')).toBeVisible();
  await keySource.selectOption('ds');
  await expect(options.locator('#search-key')).toHaveCount(0);
  await options.getByTestId('search-test').click();
  await expect(options.getByTestId('search-test-results')).toContainText('Braided cables last longer – Lab test');
  // The French copy of the first page is not listed again.
  await expect(options.getByTestId('search-test-results').locator('li')).toHaveCount(3);
  await screenshot(options, 'options-search-deepseek');

  await ask(panel, 'TEST-SEARCH: are braided cables better?');
  const run = panel.getByTestId('agent-run');
  await expect(run).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
  await expect(run.locator('[data-tool="web_search"]')).toContainText('DeepSeek');
  await expect(panel.getByTestId('assistant-message').last()).toContainText('The top result is Braided cables last longer – Lab test');
  // The question stays here unless the user turned that on.
  expect(server.searchRequests.at(-1)).toEqual({ query: 'braided cable durability', count: 16 });

  await options.locator('#deepseek-question').click();
  await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1'].search.deepseekQuestion)).toBe(true);
  await options.close();
  const searches = server.searchRequests.length;
  await ask(panel, 'TEST-SEARCH: are braided cables better?');
  await expect.poll(() => server.searchRequests.length, { timeout: 20_000 }).toBe(searches + 1);
  expect(server.searchRequests.at(-1)).toEqual({ query: 'braided cable durability', count: 16, ori_question: 'TEST-SEARCH: are braided cables better?' });

  // A search result is read through DeepSeek's Fetch API: no tab is opened for it.
  const tabs = context.pages().length;
  await ask(panel, 'TEST-READURL: how long do braided cables last?');
  await expect(panel.getByTestId('assistant-message').last()).toContainText('The guide says: Fetched guide: braided cables last 10 years.', { timeout: 20_000 });
  await expect(panel.getByTestId('agent-run').last().locator('[data-tool="read_url"][data-status="done"]')).toContainText('Read https://cables.example/guide');
  expect(server.fetchRequests).toEqual([{ url: 'https://cables.example/guide' }]);
  expect(context.pages()).toHaveLength(tabs);
  // The model is offered the tool only while reading through DeepSeek is on.
  const toolNames = () => (server.chatRequests.at(-1)!.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
  expect(toolNames()).toContain('read_url');
  await patchSettings(panel, (s) => ({ ...s, search: { ...s.search, deepseekFetch: false } }));
  await ask(panel, 'TEST-SEARCH: and plain ones?');
  await expect(panel.getByTestId('assistant-message').last()).toContainText('The top result is', { timeout: 20_000 });
  expect(toolNames()).not.toContain('read_url');
  expect(toolNames()).toContain('web_search');

  // DeepSeek's own web search, as "the model's own search": a DeepSeek model does the searching.
  const settingsBefore = await panel.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1']);
  await patchSettings(panel, (s) => ({
    ...s,
    connections: s.connections.map((c: { id: string }) => (c.id === 'ds' ? { ...c, baseURL: `${server.origin}/v1`, models: ['deepseek-v4-pro'] } : c)),
    slots: { ...s.slots, chat: { connectionId: 'ds', modelId: 'deepseek-v4-pro' } },
    search: { ...s.search, provider: 'native' },
  }));
  const nativeOptions = await context.newPage();
  await nativeOptions.goto(`chrome-extension://${extensionId}/options.html#search`);
  await nativeOptions.getByTestId('search-test').click();
  const answer = nativeOptions.getByTestId('search-test-results');
  await expect(answer).toContainText('braided cables survived ten times more bends');
  // The page the answer cites comes first; its French copy is not listed again.
  await expect(answer).toContainText('[1] Cable lab test — https://lab.example/test#1');
  await expect(answer).toContainText('[2] Cable shop — https://shop.example/cables');
  await expect(answer).not.toContainText('hl=fr');
  const sent = server.webSearchRequests.at(-1)! as unknown as { model: string; tools: unknown; thinking: unknown };
  expect(sent).toMatchObject({ model: 'deepseek-flash', tools: [{ type: 'deepseek_web_search' }], thinking: { type: 'disabled' } });
  await nativeOptions.close();
  await patchSettings(panel, () => settingsBefore);
  await panel.close();
});

test('voice input with a speech-to-text model', async () => {
  const panel = await openPanel(context, extensionId);
  await patchSettings(panel, (s) => ({
    ...s,
    voice: { engine: 'stt', language: 'en-US', autoSend: false },
    slots: { ...s.slots, stt: { connectionId: s.slots.chat.connectionId, modelId: 'whisper-1' } },
  }));
  await panel.reload();

  // In real use the first click opens this page, since side panels cannot ask
  // for the microphone. (The test browser grants it without asking.)
  const permission = await context.newPage();
  const closed = permission.waitForEvent('close');
  await permission.goto(`chrome-extension://${extensionId}/mic-permission.html`);
  await expect(permission.getByTestId('mic-permission')).toContainText('Microphone allowed');
  await screenshot(permission, 'mic-permission');
  await closed;

  await panel.getByTestId('composer-input').fill('Question:');
  await panel.getByTestId('mic-button').click();
  await expect(panel.getByTestId('mic-button')).toHaveAttribute('data-state', 'listening');
  await panel.waitForTimeout(1200);
  await screenshot(panel, 'sidepanel-voice');
  await panel.getByTestId('mic-button').click();
  await expect(panel.getByTestId('composer-input')).toHaveValue('Question: What does this page say about roaming?', { timeout: 15_000 });
  expect(server.transcriptions.at(-1)!.bytes).toBeGreaterThan(1000);
  expect(server.transcriptions.at(-1)!.contentType).toContain('multipart/form-data');
  await panel.close();
});

test('falls back to plain chat when the model rejects tools', async () => {
  const panel = await openPanel(context, extensionId);
  await patchSettings(panel, (s) => ({ ...s, slots: { ...s.slots, chat: { connectionId: s.slots.chat.connectionId, modelId: 'mock-notools' } } }));
  const site = await context.newPage();
  await site.goto(`${server.origin}/page.html`);
  await panel.bringToFront();
  await panel.reload();
  await ask(panel, 'Which plan includes US roaming?');
  await expect(panel.getByTestId('assistant-message').last()).toContainText('includes US roaming.', { timeout: 20_000 });
  const request = server.chatRequests.at(-1)!;
  expect(request.model).toBe('mock-notools');
  expect(request.tools).toBeUndefined();
  // The page is attached for the model, since it cannot read it itself.
  expect(JSON.stringify(request.messages)).toContain('Plan B costs $65 per month');
  await panel.close();
});
