import { browser } from 'wxt/browser';
import type { Connection, Settings } from '../shared/types';

const SETTINGS_KEY = 'settings:v1';
/**
 * API keys live under their own key so settings can later be synced to Drive
 * without them (§9.6). Only extension pages and the service worker read it.
 */
const SECRETS_KEY = 'secrets:v1';

type Secrets = Record<string, string>;

export function defaultSettings(): Settings {
  return { schemaVersion: 1, connections: [], slots: {}, language: 'auto', updatedAt: 0 };
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...defaultSettings(), ...stored };
}

async function saveSettings(settings: Settings): Promise<Settings> {
  const next = { ...settings, updatedAt: Date.now() };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function updateSettings(mutate: (draft: Settings) => Settings): Promise<Settings> {
  return saveSettings(mutate(await loadSettings()));
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && SETTINGS_KEY in changes) {
      listener({ ...defaultSettings(), ...(changes[SETTINGS_KEY].newValue as Partial<Settings>) });
    }
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

async function loadSecrets(): Promise<Secrets> {
  return ((await browser.storage.local.get(SECRETS_KEY))[SECRETS_KEY] as Secrets | undefined) ?? {};
}

export async function getApiKey(connectionId: string): Promise<string | undefined> {
  return (await loadSecrets())[connectionId];
}

async function writeApiKey(connectionId: string, apiKey: string | undefined): Promise<void> {
  const secrets = await loadSecrets();
  if (apiKey) secrets[connectionId] = apiKey;
  else delete secrets[connectionId];
  await browser.storage.local.set({ [SECRETS_KEY]: secrets });
}

export async function hasApiKey(connectionId: string): Promise<boolean> {
  return Boolean(await getApiKey(connectionId));
}

/**
 * Inserts or replaces a connection. `apiKey` undefined keeps the stored key,
 * an empty string removes it.
 */
export async function saveConnection(connection: Connection, apiKey?: string): Promise<Settings> {
  if (apiKey !== undefined) await writeApiKey(connection.id, apiKey);
  return updateSettings((settings) => {
    const exists = settings.connections.some((c) => c.id === connection.id);
    const connections = exists
      ? settings.connections.map((c) => (c.id === connection.id ? connection : c))
      : [...settings.connections, connection];
    return { ...settings, connections };
  });
}

/** Removes a connection, its key, and any slot that pointed at it. */
export async function deleteConnection(connectionId: string): Promise<Settings> {
  await writeApiKey(connectionId, undefined);
  return updateSettings((settings) => {
    const slots = Object.fromEntries(
      Object.entries(settings.slots).filter(([, slot]) => slot?.connectionId !== connectionId),
    );
    return { ...settings, connections: settings.connections.filter((c) => c.id !== connectionId), slots };
  });
}
