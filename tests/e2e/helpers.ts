import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const EXTENSION_PATH = path.resolve('.output-e2e/chrome-mv3');
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export async function screenshot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Let fade-in and color transitions finish.
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

export async function launch(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    executablePath: CHROMIUM,
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      // Voice input: accept the microphone prompt and feed a test tone.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, extensionId: new URL(worker.url()).host };
}

/** Writes settings and secrets straight into extension storage. */
export async function seed(context: BrowserContext, extensionId: string, settings: Record<string, unknown>, secrets: Record<string, string>) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(
    async ({ settings, secrets }) => {
      await chrome.storage.local.set({ 'settings:v1': { schemaVersion: 1, language: 'auto', sitePolicies: {}, updatedAt: 1, ...settings }, 'secrets:v1': secrets });
    },
    { settings, secrets },
  );
  await page.close();
}

/** Changes stored settings from an extension page. */
export async function patchSettings(page: Page, patch: (settings: Record<string, any>) => Record<string, any>) {
  const current = await page.evaluate(async () => (await chrome.storage.local.get('settings:v1'))['settings:v1']);
  const next = patch(current);
  await page.evaluate(async (value) => chrome.storage.local.set({ 'settings:v1': value }), next);
}

export async function openPanel(context: BrowserContext, extensionId: string, height = 820): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

/** Opens a site, then the panel as a tab; the panel targets the site (its most recent other tab). */
export async function openSiteAndPanel(context: BrowserContext, extensionId: string, url: string) {
  const site = await context.newPage();
  await site.goto(url);
  const panel = await openPanel(context, extensionId);
  return { site, panel };
}

export async function ask(panel: Page, text: string) {
  const input = panel.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
}

export async function chooseMode(panel: Page, mode: 'query' | 'auto' | 'manual') {
  await panel.getByTestId('mode-picker').click();
  await panel.getByTestId(`mode-option-${mode}`).click();
  await expect(panel.getByTestId('mode-picker')).toHaveAttribute('data-mode', mode);
}

/** Tab group of a tab, read from an extension page. */
export async function groupOf(page: Page, url: string): Promise<{ title?: string; color?: string } | undefined> {
  return page.evaluate(async (target) => {
    const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === target);
    if (!tab || tab.groupId === undefined || tab.groupId < 0) return undefined;
    const group = await chrome.tabGroups.get(tab.groupId);
    return { title: group.title, color: group.color };
  }, url);
}
