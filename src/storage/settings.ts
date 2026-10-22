import { browser } from 'wxt/browser';
import type { AgentSettings, Connection, SearchProviderId, SearchSettings, Settings, VoiceSettings } from '../shared/types';

const SETTINGS_KEY = 'settings:v1';
/**
 * API keys live under their own key so settings can later be synced to Drive
 * without them (§9.6). Only extension pages and the service worker read it.
 */
const SECRETS_KEY = 'secrets:v1';

type Secrets = Record<string, string>;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  mode: 'auto',
  useCdp: true,
  maxSteps: 30,
  notifications: true,
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  provider: 'browser',
  engine: 'google',
  customUrl: '',
  cloudflare: { accountId: '', gatewayId: 'default', source: 'ceramic' },
  fallbackToBrowser: true,
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engine: 'browser',
  language: 'auto',
  autoSend: false,
};

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    connections: [],
    slots: {},
    language: 'auto',
    agent: DEFAULT_AGENT_SETTINGS,
    search: DEFAULT_SEARCH_SETTINGS,
    voice: DEFAULT_VOICE_SETTINGS,
    sitePolicies: {},
    updatedAt: 0,
  };
}

/** Settings as saved by older versions. */
type StoredSettings = Partial<Settings> & {
  agent?: Partial<AgentSettings> & { searchEngine?: SearchSettings['engine']; customSearchUrl?: string };
  slots?: Record<string, unknown>;
};

/** Fills in fields added after the settings were first saved, and migrates old ones. */
export function withDefaults(stored: StoredSettings | undefined): Settings {
  const defaults = defaultSettings();
  // M1 kept the browser search engine with the agent settings.
  const { searchEngine, customSearchUrl, ...agent } = stored?.agent ?? {};
  const legacySearch: Partial<SearchSettings> = {
    ...(searchEngine ? { engine: searchEngine } : {}),
    ...(customSearchUrl ? { customUrl: customSearchUrl } : {}),
  };
  // M1's separate agent model now follows the current model.
  const { agent: _agentSlot, ...slots } = (stored?.slots ?? {}) as Settings['slots'] & { agent?: unknown };
  return {
    ...defaults,
    ...stored,
    slots,
    agent: { ...defaults.agent, ...agent },
    search: {
      ...defaults.search,
      ...legacySearch,
      ...stored?.search,
      cloudflare: { ...defaults.search.cloudflare, ...stored?.search?.cloudflare },
    },
    voice: { ...defaults.voice, ...stored?.voice },
  };
}

export async function loadSettings(): Promise<Settings> {
  return withDefaults((await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as StoredSettings | undefined);
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
      listener(withDefaults(changes[SETTINGS_KEY]!.newValue as StoredSettings));
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

/** Search API keys share the secrets store, under `search:<provider>`. */
const searchKeyId = (provider: SearchProviderId) => `search:${provider}`;

export function getSearchKey(provider: SearchProviderId): Promise<string | undefined> {
  return getApiKey(searchKeyId(provider));
}

export function saveSearchKey(provider: SearchProviderId, key: string): Promise<void> {
  return writeApiKey(searchKeyId(provider), key.trim() || undefined);
}

/** Stars or unstars a model of a connection. */
export async function toggleFavoriteModel(connectionId: string, modelId: string): Promise<Settings> {
  return updateSettings((settings) => ({
    ...settings,
    connections: settings.connections.map((c) => {
      if (c.id !== connectionId) return c;
      const favorites = c.favoriteModels ?? [];
      const next = favorites.includes(modelId) ? favorites.filter((m) => m !== modelId) : [...favorites, modelId];
      return { ...c, favoriteModels: next };
    }),
  }));
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
