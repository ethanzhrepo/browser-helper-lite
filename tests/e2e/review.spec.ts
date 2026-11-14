import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ask, chooseMode, EXTENSION_PATH, groupOf, launch, openPanel, openSiteAndPanel, screenshot, seed, tabIdOf } from './helpers';
import { indexOf, MOCK_KEY, MOCK_MODEL, readTurn, say, startMockServer, type ChatMessage, type Reply } from './mock-llm-server';

/** A form that deletes the account, with a field a page could name anything: here "q", like a search box. */
const SEARCH_NAMED_HTML = `<!doctype html><title>Account</title>
<form method="post" action="/deleted"><input name="q" placeholder="Search" autofocus><button type="submit">Delete account</button></form>`;

/** The same form sent with GET, its field focused. */
const COUPON_HTML = `<!doctype html><title>Coupon</title>
<form method="get" action="/deleted-get"><input name="coupon" aria-label="Coupon" autofocus><button type="submit">Delete account</button></form>
<p style="height:3000px">Tall page</p>`;

let replies = 0;

function assistant(messages: ChatMessage[]): Reply {
  const { request, history, view } = readTurn(messages);
  const used = (tool: string) => history.includes(`- ${tool} `);
  if (request.includes('RV-SEARCHFORM')) {
    if (!used('view_page')) return say('Looking.', 'view_page');
    if (!used('type')) return say('Searching.', 'type', { index: indexOf(view, /\[(\d+)\]<input[^\n]*name="q"/), text: 'cables', submit: true });
    return say('Finished with the form.');
  }
  if (request.includes('RV-PRESS')) {
    if (!used('press')) return say('Pressing Enter.', 'press', { keys: 'Enter' });
    return say('Finished pressing.');
  }
  if (request.includes('RV-BLOCKED')) {
    if (!used('press')) return say('Pressing Enter.', 'press', { keys: 'Enter' });
    if (!used('scroll')) return say('Scrolling.', 'scroll', { direction: 'down' });
    return say('I could not use this site.');
  }
  replies += 1;
  return say(`Reply number ${replies}.`);
}

const settingsFor = (origin: string, extra: Record<string, unknown> = {}) => ({
  connections: [{ id: 'mock', vendor: 'openai-compatible', presetId: 'custom', name: 'Mock provider', baseURL: `${origin}/v1`, models: [MOCK_MODEL], createdAt: 1, updatedAt: 1 }],
  slots: { chat: { connectionId: 'mock', modelId: MOCK_MODEL } },
  agent: { mode: 'auto', useCdp: true, maxSteps: 20, notifications: false },
  ...extra,
});

const pages = { '/account.html': SEARCH_NAMED_HTML, '/coupon.html': COUPON_HTML };

/** Rows in a table of the extension's database, read from one of its pages. */
const countRows = (page: Page, table: string) =>
  page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('browser-helper');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).count();
          request.onsuccess = () => resolve(request.result);
        };
      }),
    table,
  );

const done = (panel: Page) => expect(panel.getByTestId('agent-run').last()).toHaveAttribute('data-status', 'done', { timeout: 30_000 });

test.describe.serial('review fixes: what a step may touch', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    server = await startMockServer({ assistant, pages });
    ({ context, extensionId } = await launch());
    await seed(context, extensionId, settingsFor(server.origin), { mock: MOCK_KEY });
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('a fresh install opens the settings with a welcome note', async () => {
    await expect.poll(() => context.pages().some((page) => page.url().includes('options.html?welcome=1'))).toBe(true);
    const options = context.pages().find((page) => page.url().includes('options.html?welcome=1'))!;
    await expect(options.getByTestId('welcome')).toContainText('Two steps to get started');
    await options.close();
  });

  test('the manifest has the shortcut, the page menu and a closed content security policy', () => {
    const manifest = JSON.parse(readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    expect(manifest.commands._execute_action.suggested_key.default).toBe('Alt+Shift+H');
    expect(manifest.permissions).toContain('contextMenus');
    const csp: string = manifest.content_security_policy.extension_pages;
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "object-src 'none'", "frame-src 'none'"]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain('unsafe-eval');
  });

  test('a field named like a search box does not make "Delete account" a search', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/account.html`);
    // Query mode reads and searches only: this form is neither.
    await chooseMode(panel, 'query');
    await ask(panel, 'RV-SEARCHFORM: search for cables');
    await done(panel);
    await expect(panel.locator('[data-testid="agent-action"][data-tool="type"]')).toHaveAttribute('data-status', 'rejected');
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    expect(server.hits).not.toContain('/deleted');
    await expect(site.locator('input[name="q"]')).toHaveValue('');

    // Auto mode asks, as for any deletion, and says which form Enter sends.
    await panel.getByRole('button', { name: 'New chat' }).click();
    await chooseMode(panel, 'auto');
    await ask(panel, 'RV-SEARCHFORM: search for cables again');
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('High-risk action', { timeout: 30_000 });
    await expect(approval.getByTestId('approval-submits')).toContainText('Delete account');
    await approval.getByRole('button', { name: 'Deny' }).click();
    await done(panel);
    expect(server.hits).not.toContain('/deleted');
    await site.close();
    await panel.close();
  });

  test('a key press shows what it lands on; Escape denies, and only Ctrl+Enter approves a high-risk step', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/coupon.html`);
    const sent = () => server.hits.filter((hit) => hit.startsWith('/deleted-get')).length;
    await ask(panel, 'RV-PRESS: press Enter');
    const approval = panel.getByTestId('approval-card');
    await expect(approval).toContainText('High-risk action', { timeout: 30_000 });
    await expect(approval).toContainText('Press Enter in input "Coupon"');
    await expect(approval.getByTestId('approval-submits')).toContainText('This sends the form “Delete account”.');
    // Past the moment in which a card ignores approvals.
    await panel.waitForTimeout(700);
    await panel.keyboard.press('Enter');
    await panel.waitForTimeout(300);
    await expect(approval).toBeVisible();
    await panel.keyboard.press('Escape');
    await done(panel);
    await expect(panel.locator('[data-testid="agent-action"][data-tool="press"]')).toHaveAttribute('data-status', 'rejected');
    expect(sent()).toBe(0);

    await panel.getByRole('button', { name: 'New chat' }).click();
    await ask(panel, 'RV-PRESS: press Enter once more');
    await expect(approval).toContainText('High-risk action', { timeout: 30_000 });
    await panel.waitForTimeout(700);
    await panel.keyboard.press('Control+Enter');
    await done(panel);
    await expect.poll(sent).toBe(1);
    await site.close();
    await panel.close();
  });
});

test.describe.serial('review fixes: a blocked site is left alone', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    server = await startMockServer({ assistant, pages });
    ({ context, extensionId } = await launch());
    await seed(context, extensionId, settingsFor(server.origin, { sitePolicies: { '127.0.0.1': 'blocked' } }), { mock: MOCK_KEY });
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  test('no key, no scrolling, no overlay and no tab group on a blocked site', async () => {
    const { site, panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/coupon.html`);
    await ask(panel, 'RV-BLOCKED: press Enter and scroll');
    await done(panel);
    await expect(panel.locator('[data-testid="agent-action"][data-tool="press"]')).toHaveAttribute('data-status', 'rejected');
    await expect(panel.locator('[data-testid="agent-action"][data-tool="scroll"]')).toHaveAttribute('data-status', 'rejected');
    await expect(panel.getByTestId('approval-card')).toHaveCount(0);
    expect(server.hits.some((hit) => hit.startsWith('/deleted-get'))).toBe(false);
    expect(await site.evaluate(() => window.scrollY)).toBe(0);
    await expect(site.locator('browser-helper-overlay')).toHaveCount(0);
    expect(await groupOf(panel, site.url())).toBeUndefined();
    await expect(panel.getByTestId('driver-badge')).toHaveCount(0);
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).toContain('The user blocked 127.0.0.1 for the assistant');
  });
});

test.describe.serial('review fixes: conversations and data', () => {
  let context: BrowserContext;
  let extensionId: string;
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let panel: Page;

  test.beforeAll(async () => {
    replies = 0;
    server = await startMockServer({ assistant, pages });
    ({ context, extensionId } = await launch());
    await seed(context, extensionId, settingsFor(server.origin), { mock: MOCK_KEY });
    ({ panel } = await openSiteAndPanel(context, extensionId, `${server.origin}/page.html`));
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.close();
  });

  const assistantMessages = () => panel.getByTestId('assistant-message');

  test('regenerate replaces the reply; editing a request replaces it and what followed', async () => {
    await ask(panel, 'First question about pineapples');
    await expect(assistantMessages().last()).toContainText('Reply number 1.', { timeout: 20_000 });
    await assistantMessages().last().hover();
    await expect(assistantMessages().last().getByTestId('usage')).toBeAttached();
    await panel.getByTestId('regenerate').click();
    await expect(assistantMessages().last()).toContainText('Reply number 2.', { timeout: 20_000 });
    await expect(assistantMessages()).toHaveCount(1);
    await expect(panel.getByTestId('user-message')).toHaveCount(1);
    // The replaced reply is not part of what the model is sent.
    expect(JSON.stringify(server.chatRequests.at(-1)!.messages)).not.toContain('Reply number 1.');

    await panel.getByTestId('user-message').hover();
    await panel.getByTestId('edit-message').click();
    await panel.getByTestId('edit-input').fill('Edited question about mangoes');
    await panel.getByTestId('edit-input').press('Enter');
    await expect(assistantMessages().last()).toContainText('Reply number 3.', { timeout: 20_000 });
    await expect(panel.getByTestId('user-message')).toHaveText(['Edited question about mangoes']);
    await expect(assistantMessages()).toHaveCount(1);
    const sent = JSON.stringify(server.chatRequests.at(-1)!.messages);
    expect(sent).toContain('mangoes');
    expect(sent).not.toContain('pineapples');
  });

  test('history: search finds message text; a delete can be undone, then erases the messages', async () => {
    await panel.getByRole('button', { name: 'History' }).click();
    const items = panel.getByTestId('history-item');
    // The title was renamed with the edited first message; the reply text is found too.
    await expect(items).toContainText(['Edited question about mangoes']);
    await panel.getByTestId('history-search').fill('reply number 3');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Reply number 3.');
    await panel.getByTestId('history-search').fill('nothing like this');
    await expect(items).toHaveCount(0);
    await panel.getByTestId('history-search').fill('');

    await items.first().hover();
    await items.first().getByRole('button', { name: 'Delete' }).click();
    await expect(items).toHaveCount(0);
    await panel.getByTestId('history-undo').getByRole('button', { name: 'Undo' }).click();
    await expect(items).toHaveCount(1);
    expect(await countRows(panel, 'messages')).toBeGreaterThan(0);

    await items.first().hover();
    await items.first().getByRole('button', { name: 'Delete' }).click();
    await expect(panel.getByTestId('history-undo')).toBeVisible();
    // Leaving the history ends the undo time: nothing of the conversation is kept.
    await panel.keyboard.press('Escape');
    await expect(panel.getByTestId('history-panel')).toHaveCount(0);
    await expect.poll(() => countRows(panel, 'messages')).toBe(0);
    expect(await countRows(panel, 'tasks')).toBe(0);
    await expect(panel.getByText('How can I help?')).toBeVisible();
  });

  test('the page menu hands a selection to the panel of its tab', async () => {
    const site = context.pages().find((page) => page.url().endsWith('/page.html'))!;
    const tabId = await tabIdOf(context, site);
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(
      async ({ tabId, url }) => {
        const context = { kind: 'selection', title: 'Mobile Plans Test', url, content: 'Roaming in the US is included with Plan B.', truncated: false, capturedAt: Date.now() };
        await chrome.storage.session.set({ [`panelRequest:${tabId}`]: { kind: 'selection', context, at: Date.now() } });
      },
      { tabId, url: site.url() },
    );
    await expect(panel.getByText(/“Roaming in the US is included with Plan…”/)).toBeVisible();
    await expect(panel.getByTestId('composer-input')).toBeFocused();
    // Taken once.
    expect(await worker.evaluate(async (id) => Object.keys(await chrome.storage.session.get(`panelRequest:${id}`)).length, tabId)).toBe(0);
  });

  test('data: export plain or encrypted, delete everything, import it back', async () => {
    await ask(panel, 'A conversation worth keeping');
    await expect(assistantMessages().last()).toContainText('Reply number', { timeout: 20_000 });

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#data`);
    const note = options.getByTestId('data-note');
    const exportFile = async () => {
      const download = options.waitForEvent('download');
      await options.getByTestId('export-data').click();
      return (await download).path();
    };

    // Encryption is on to begin with, and asks for a password twice.
    await options.getByTestId('export-data').click();
    await expect(note).toContainText('Use at least 8 characters.');
    await options.getByTestId('export-password').fill('correct horse');
    await options.getByTestId('export-password-again').fill('correct house');
    await options.getByTestId('export-data').click();
    await expect(note).toContainText("The passwords don't match.");
    await options.getByTestId('export-password-again').fill('correct horse');
    await screenshot(options, 'options-data-export');
    const locked = await exportFile();
    const sealed = readFileSync(locked, 'utf8');
    expect(JSON.parse(sealed).encrypted).toMatchObject({ cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256' });
    expect(sealed).not.toContain('A conversation worth keeping');
    expect(sealed).not.toContain(MOCK_KEY);
    // The password is not kept in the form.
    await expect(options.getByTestId('export-password')).toHaveValue('');

    // Without encryption the file is readable, and never holds keys.
    await options.locator('#encrypt-backup').click();
    await expect(options.locator('#include-keys')).toBeDisabled();
    const file = await exportFile();
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    expect(backup.conversations).toHaveLength(1);
    expect(JSON.stringify(backup)).toContain('A conversation worth keeping');
    expect(JSON.stringify(backup)).not.toContain(MOCK_KEY);
    expect(backup.secrets).toBeUndefined();

    options.on('dialog', (dialog) => void dialog.accept());
    await options.getByTestId('clear-conversations').click();
    await expect(options.getByTestId('data-note')).toContainText('All conversations deleted.');
    expect(await countRows(options, 'conversations')).toBe(0);
    expect(await countRows(options, 'messages')).toBe(0);

    await options.getByTestId('import-file').setInputFiles(file);
    await expect(options.getByTestId('data-note')).toContainText('Imported. 1 conversation added.');
    expect(await countRows(options, 'messages')).toBe(2);
    // The connection kept its address, so it kept its key.
    const storedKey = () => options.evaluate(async () => ((await chrome.storage.local.get('secrets:v1'))['secrets:v1'] as Record<string, string> | undefined)?.mock);
    expect(await storedKey()).toBe(MOCK_KEY);

    // The encrypted file asks for its password, and brings the keys back with it.
    await options.getByTestId('clear-conversations').click();
    await expect(note).toContainText('All conversations deleted.');
    await options.evaluate(() => chrome.storage.local.remove('secrets:v1'));
    await options.getByTestId('import-file').setInputFiles(locked);
    await expect(options.getByTestId('import-locked')).toContainText('is encrypted. Enter its password.');
    expect(await countRows(options, 'conversations')).toBe(0);
    await options.getByTestId('import-password').fill('wrong horse');
    await options.getByTestId('import-unlock').click();
    await expect(note).toContainText('Wrong password, or the file is damaged.');
    await screenshot(options, 'options-data-import-password');
    expect(await countRows(options, 'conversations')).toBe(0);
    await options.getByTestId('import-password').fill('correct horse');
    await options.getByTestId('import-password').press('Enter');
    await expect(note).toContainText('Imported. 1 conversation added.');
    await expect(options.getByTestId('import-locked')).toHaveCount(0);
    expect(await countRows(options, 'messages')).toBe(2);
    expect(await storedKey()).toBe(MOCK_KEY);

    await options.getByTestId('reset-everything').click();
    await expect(options.getByTestId('data-note')).toContainText('Everything erased.');
    expect(await options.evaluate(async () => Object.keys(await chrome.storage.local.get(['settings:v1', 'secrets:v1'])).length)).toBe(0);
    expect(await countRows(options, 'conversations')).toBe(0);
    await options.close();

    // With no model left, the panel is back at the setup card.
    const fresh = await openPanel(context, extensionId);
    await expect(fresh.getByTestId('setup-card')).toBeVisible();
  });
});
