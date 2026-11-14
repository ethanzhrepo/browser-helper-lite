import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AgentTask } from '../../src/agent/types';
import type { Connection } from '../../src/shared/types';
import { buildBackup, decryptBackup, parseBackup, readBackupFile, restoreBackup, serializeBackup } from '../../src/storage/backup';
import { seal, unseal, WrongPasswordError } from '../../src/storage/backup-crypto';
import {
  appendMessage,
  clearConversations,
  createConversation,
  db,
  deleteConversation,
  deriveTitle,
  getMessages,
  getTasks,
  listConversations,
  PURGE_GRACE_MS,
  purgeConversation,
  purgeDeleted,
  restoreConversation,
  saveTask,
  searchMessages,
  truncateConversation,
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
    expect(migrated.agent).toEqual({ mode: 'auto', useCdp: false, maxSteps: 20, notifications: true, screenshots: 'auto', autoScreenshot: true });
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

describe('deleting and replacing conversations', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await clearConversations();
  });

  const task = (id: string, conversationId: string, anchorMessageId: string): AgentTask => ({
    id,
    conversationId,
    goal: 'a goal',
    anchorMessageId,
    status: 'done',
    steps: [{ index: 1, actions: [] }],
    draft: '',
    usage: {},
    model: { connectionId: 'a', modelId: 'm' },
    mode: 'auto',
    startTabId: 1,
    groupedTabs: [7],
    maxSteps: 30,
    createdAt: 1,
    updatedAt: 1,
  });

  const seedChat = async () => {
    const conversation = await createConversation('Secret plans');
    const page = { kind: 'page' as const, title: 'Bank', url: 'https://bank.example/', content: 'balance 1234', truncated: false, capturedAt: 1 };
    const request = await appendMessage({ conversationId: conversation.id, role: 'user', content: 'What is my balance?', contexts: [page], status: 'done', taskId: 't1' });
    const reply = await appendMessage({ conversationId: conversation.id, role: 'assistant', content: 'It is 1234 dollars.', status: 'done', taskId: 't1' });
    await saveTask(task('t1', conversation.id, request.id));
    return { conversation, request, reply };
  };

  it('can undo a delete until it is purged, and purging erases the content', async () => {
    const { conversation } = await seedChat();
    await deleteConversation(conversation.id);
    expect(await listConversations()).toHaveLength(0);
    expect(await restoreConversation(conversation.id)).toBe(true);
    expect((await listConversations())[0]!.title).toBe('Secret plans');

    await deleteConversation(conversation.id);
    await purgeConversation(conversation.id);
    expect(await db.messages.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    // Only an empty marker is left.
    const marker = (await db.conversations.get(conversation.id))!;
    expect(marker.title).toBe('');
    expect(JSON.stringify(marker)).not.toContain('Secret');
    expect(await restoreConversation(conversation.id)).toBe(false);
  });

  it('writes nothing more into an erased conversation', async () => {
    const { conversation, request } = await seedChat();
    await deleteConversation(conversation.id);
    await purgeConversation(conversation.id);
    await appendMessage({ conversationId: conversation.id, role: 'assistant', content: 'late reply', status: 'done' });
    await saveTask(task('t2', conversation.id, request.id));
    expect(await db.messages.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });

  it('purges forgotten deletions only after the undo time', async () => {
    const { conversation } = await seedChat();
    await deleteConversation(conversation.id);
    expect(await purgeDeleted(Date.now())).toBe(0);
    expect(await db.messages.count()).toBe(2);
    expect(await purgeDeleted(Date.now() + PURGE_GRACE_MS + 1)).toBe(1);
    expect(await db.messages.count()).toBe(0);
  });

  it('replaces a reply: later messages are emptied and their turns discarded', async () => {
    const { conversation, request } = await seedChat();
    await truncateConversation(conversation.id, request.id, { keepFirst: true });
    expect((await getMessages(conversation.id)).map((m) => m.content)).toEqual(['What is my balance?']);
    const stored = await db.messages.toArray();
    expect(JSON.stringify(stored.find((m) => m.role === 'assistant'))).not.toContain('1234');
    expect(await getTasks(conversation.id)).toHaveLength(0);
    // Kept for the tabs it grouped, with nothing else in it.
    const [discarded] = await getTasks(conversation.id, { discarded: true });
    expect(discarded).toMatchObject({ groupedTabs: [7], steps: [], goal: '' });
  });

  it('replaces a request and what followed it', async () => {
    const { conversation, request } = await seedChat();
    await truncateConversation(conversation.id, request.id);
    expect(await getMessages(conversation.id)).toHaveLength(0);
    expect(JSON.stringify(await db.messages.toArray())).not.toContain('balance');
  });

  it('finds conversations by what was said, not by attached pages', async () => {
    const { conversation } = await seedChat();
    expect((await searchMessages('1234 DOLLARS')).get(conversation.id)).toContain('It is 1234 dollars.');
    expect((await searchMessages('bank.example')).size).toBe(0);
    await deleteConversation(conversation.id);
    await purgeConversation(conversation.id);
    expect((await searchMessages('dollars')).size).toBe(0);
  });
});

describe('backups', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await clearConversations();
  });

  it('leaves API keys out unless asked, and round-trips conversations', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    const conversation = await createConversation('Hello');
    await appendMessage({ conversationId: conversation.id, role: 'user', content: 'Hi', status: 'done' });
    const plain = await buildBackup({ includeKeys: false });
    expect(JSON.stringify(plain)).not.toContain('sk-secret');
    const withKeys = parseBackup(JSON.stringify(await buildBackup({ includeKeys: true })));
    expect(withKeys.secrets).toEqual({ a: 'sk-secret' });

    await clearConversations();
    fakeBrowser.reset();
    const summary = await restoreBackup(withKeys);
    expect(summary).toMatchObject({ settings: true, conversations: 1, keys: 1 });
    expect(await getApiKey('a')).toBe('sk-secret');
    expect((await getMessages(conversation.id))[0]!.content).toBe('Hi');
  });

  it('never sends a stored key to an address a backup file changed', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    await saveConnection(connection('b'), 'sk-other');
    const backup = parseBackup(JSON.stringify(await buildBackup({ includeKeys: false })));
    backup.settings!.connections[0]!.baseURL = 'https://evil.example/v1';
    await restoreBackup(backup);
    expect((await loadSettings()).connections[0]!.baseURL).toBe('https://evil.example/v1');
    expect(await getApiKey('a')).toBeUndefined();
    // The connection whose address did not change keeps its key.
    expect(await getApiKey('b')).toBe('sk-other');
  });

  it('encrypts a backup with a password and opens it only with that password', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    const conversation = await createConversation('Private plans');
    await appendMessage({ conversationId: conversation.id, role: 'user', content: 'My salary is 1234', status: 'done' });
    const text = await serializeBackup(await buildBackup({ includeKeys: true }), 'correct horse');
    // Nothing of the content is readable in the file.
    for (const secret of ['sk-secret', 'Private plans', 'salary', 'api.example']) expect(text).not.toContain(secret);
    const read = readBackupFile(text);
    if (!('encrypted' in read)) throw new Error('expected an encrypted file');
    expect(read.encrypted.encrypted).toMatchObject({ cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600_000 });
    await expect(decryptBackup(read.encrypted, 'wrong horse')).rejects.toBeInstanceOf(WrongPasswordError);

    await clearConversations();
    fakeBrowser.reset();
    const summary = await restoreBackup(await decryptBackup(read.encrypted, 'correct horse'));
    expect(summary).toMatchObject({ settings: true, conversations: 1, keys: 1 });
    expect(await getApiKey('a')).toBe('sk-secret');
    expect((await getMessages(conversation.id))[0]!.content).toBe('My salary is 1234');
  });

  it('writes API keys only into an encrypted file, and can leave conversations out', async () => {
    await saveConnection(connection('a'), 'sk-secret');
    await createConversation('Hello');
    await expect(serializeBackup(await buildBackup({ includeKeys: true }))).rejects.toThrow(/encrypted/);
    const settingsOnly = await buildBackup({ includeKeys: false, includeConversations: false });
    expect(settingsOnly.conversations).toBeUndefined();
    const read = readBackupFile(await serializeBackup(settingsOnly));
    if (!('backup' in read)) throw new Error('expected a plain file');
    expect(read.backup.settings!.connections).toHaveLength(1);
    // Applying it changes the settings and leaves the conversations here alone.
    expect(await restoreBackup(read.backup)).toMatchObject({ settings: true, conversations: 0 });
    expect(await listConversations()).toHaveLength(1);
  });

  it('gives a different file each time, and notices any change to one', async () => {
    const first = await seal('{"a":1}', 'password-1', 100_000);
    const second = await seal('{"a":1}', 'password-1', 100_000);
    expect(first.salt).not.toBe(second.salt);
    expect(first.data).not.toBe(second.data);
    expect(await unseal(first, 'password-1')).toBe('{"a":1}');
    // The same password however it was typed (full-width letters, here).
    expect(await unseal(first, 'ｐａｓｓｗｏｒｄ-1')).toBe('{"a":1}');
    const flipped = atob(first.data).split('');
    flipped[0] = String.fromCharCode(flipped[0]!.charCodeAt(0) ^ 1);
    await expect(unseal({ ...first, data: btoa(flipped.join('')) }, 'password-1')).rejects.toBeInstanceOf(WrongPasswordError);
    // A file may not ask for a key derivation too weak to protect it, or too long to wait for.
    await expect(unseal({ ...first, iterations: 1 }, 'password-1')).rejects.toThrow(/Damaged/);
    await expect(unseal({ ...first, iterations: 1e12 }, 'password-1')).rejects.toThrow(/Damaged/);
    await expect(unseal({ ...first, iv: btoa('short') }, 'password-1')).rejects.toThrow(/Damaged/);
    expect(() => readBackupFile(JSON.stringify({ app: 'browser-helper-lite', version: 1, exportedAt: 1, encrypted: { ...first, iterations: 1 } }))).toThrow();
    expect(() => readBackupFile(JSON.stringify({ app: 'something-else', version: 1, exportedAt: 1, encrypted: first }))).toThrow();
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow();
    expect(() => parseBackup('{"app":"something-else","version":1,"exportedAt":1}')).toThrow();
    expect(() => parseBackup(JSON.stringify({ app: 'browser-helper-lite', version: 1, exportedAt: 1, settings: { connections: [], sitePolicies: { 'bank.example': 'anything' } } }))).toThrow();
  });
});
