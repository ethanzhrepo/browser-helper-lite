import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Connection } from '../../src/shared/types';
import {
  appendMessage,
  createConversation,
  db,
  deleteConversation,
  deriveTitle,
  getMessages,
  listConversations,
} from '../../src/storage/db';
import {
  deleteConnection,
  getApiKey,
  getSearchKey,
  loadSettings,
  saveConnection,
  saveSearchKey,
  toggleFavoriteModel,
  updateSettings,
  withDefaults,
} from '../../src/storage/settings';

const connection = (id: string): Connection => ({
  id,
  vendor: 'openai',
  name: id,
  baseURL: 'https://api.openai.com/v1',
  models: ['gpt-5-mini'],
  createdAt: 1,
  updatedAt: 1,
});

describe('settings and secrets', () => {
  beforeEach(() => fakeBrowser.reset());

  it('keeps API keys out of the settings object', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    const settings = await loadSettings();
    expect(settings.connections).toHaveLength(1);
    expect(JSON.stringify(settings)).not.toContain('sk-secret');
    expect(await getApiKey('a')).toBe('sk-secret');
  });

  it('keeps the stored key when saving without one', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    await saveConnection({ ...connection('a'), name: 'renamed' });
    expect(await getApiKey('a')).toBe('sk-secret');
    expect((await loadSettings()).connections[0]!.name).toBe('renamed');
  });

  it('removes the key and dependent slots when a connection is deleted', async () => {
    await saveConnection(connection('a'), 'sk-a');
    await saveConnection(connection('b'), 'sk-b');
    await updateSettings((s) => ({
      ...s,
      slots: { chat: { connectionId: 'a', modelId: 'gpt-5-mini' }, fast: { connectionId: 'b', modelId: 'gpt-5-mini' } },
    }));
    await deleteConnection('a');
    const settings = await loadSettings();
    expect(settings.connections.map((c) => c.id)).toEqual(['b']);
    expect(settings.slots.chat).toBeUndefined();
    expect(settings.slots.fast?.connectionId).toBe('b');
    expect(await getApiKey('a')).toBeUndefined();
  });
});

describe('settings defaults and migration', () => {
  beforeEach(() => fakeBrowser.reset());

  it('defaults to Auto mode, browser search and Chrome speech recognition', async () => {
    const settings = await loadSettings();
    expect(settings.agent.mode).toBe('auto');
    expect(settings.search.provider).toBe('browser');
    expect(settings.voice.engine).toBe('browser');
  });

  it('moves the M1 search engine out of the agent settings and drops the agent slot', () => {
    const migrated = withDefaults({
      agent: { useCdp: false, maxSteps: 20, notifications: true, searchEngine: 'custom', customSearchUrl: 'https://s.example/?q=%s' },
      slots: { chat: { connectionId: 'a', modelId: 'm' }, agent: { connectionId: 'b', modelId: 'n' } },
    } as never);
    expect(migrated.agent).toEqual({ mode: 'auto', useCdp: false, maxSteps: 20, notifications: true });
    expect(migrated.search.engine).toBe('custom');
    expect(migrated.search.customUrl).toBe('https://s.example/?q=%s');
    expect(Object.keys(migrated.slots)).toEqual(['chat']);
  });

  it('stores search keys with the other secrets, outside the settings', async () => {
    await saveSearchKey('tavily', ' tvly-key ');
    expect(await getSearchKey('tavily')).toBe('tvly-key');
    expect(JSON.stringify(await loadSettings())).not.toContain('tvly-key');
    await saveSearchKey('tavily', '');
    expect(await getSearchKey('tavily')).toBeUndefined();
  });

  it('stars and unstars models', async () => {
    await saveConnection(connection('a'));
    await toggleFavoriteModel('a', 'gpt-5-mini');
    expect((await loadSettings()).connections[0]!.favoriteModels).toEqual(['gpt-5-mini']);
    await toggleFavoriteModel('a', 'gpt-5-mini');
    expect((await loadSettings()).connections[0]!.favoriteModels).toEqual([]);
  });
});

describe('conversation store', () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it('returns messages in the order they were appended', async () => {
    const conversation = await createConversation('Test');
    for (const content of ['one', 'two', 'three', 'four']) {
      await appendMessage({ conversationId: conversation.id, role: 'user', content, status: 'done' });
    }
    expect((await getMessages(conversation.id)).map((m) => m.content)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('tombstones deleted conversations and lists the latest first', async () => {
    const older = await createConversation('older');
    const newer = await createConversation('newer');
    await appendMessage({ conversationId: newer.id, role: 'user', content: 'hi', status: 'done' });
    expect((await listConversations()).map((c) => c.title)).toEqual(['newer', 'older']);

    await deleteConversation(older.id);
    expect((await listConversations()).map((c) => c.title)).toEqual(['newer']);
    expect((await db.conversations.get(older.id))?.deletedAt).toBeTypeOf('number');
  });

  it('derives a one-line title', () => {
    expect(deriveTitle('  First line\nsecond')).toBe('First line');
    expect(deriveTitle('x'.repeat(100))).toHaveLength(60);
  });
});
