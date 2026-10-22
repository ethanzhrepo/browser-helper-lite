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
import { deleteConnection, getApiKey, loadSettings, saveConnection, updateSettings } from '../../src/storage/settings';

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
