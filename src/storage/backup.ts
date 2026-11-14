import { browser } from 'wxt/browser';
import { z } from 'zod';
import { ACTIVE_STATUSES, type AgentTask } from '../agent/types';
import { normalizeBaseURL } from '../providers/vendors';
import type { ConversationRecord, MessageRecord, Settings } from '../shared/types';
import { MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, seal, unseal, type Sealed } from './backup-crypto';
import { db } from './db';
import { loadSecrets, loadSettings, replaceSettings, withDefaults } from './settings';

// Zod's JIT uses eval, which the extension's CSP forbids.
z.config({ jitless: true });

/**
 * A backup file: settings and, when asked for, conversations and API keys.
 * With a password it is encrypted (see backup-crypto.ts); without one it is
 * plain JSON that anyone who gets the file can read, so it never holds keys.
 */
export const BACKUP_APP = 'browser-helper-lite';
export const BACKUP_VERSION = 1;

const usage = z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional();
const modelRef = z.object({ connectionId: z.string(), modelId: z.string() });
const errorInfo = z.object({ code: z.string(), message: z.string(), status: z.number().optional() });

const connectionSchema = z.looseObject({
  id: z.string().min(1),
  vendor: z.enum(['openai', 'anthropic', 'google', 'deepseek', 'openai-compatible']),
  name: z.string(),
  baseURL: z.string(),
  models: z.array(z.string()),
});

const slotSchema = z.object({ connectionId: z.string(), modelId: z.string(), temperature: z.number().optional() });

/** Checked where a wrong value could do harm or break the pages; unknown fields pass, older ones are migrated on load. */
const settingsSchema = z.looseObject({
  connections: z.array(connectionSchema),
  slots: z.record(z.string(), slotSchema).optional(),
  language: z.enum(['auto', 'zh-CN', 'en', 'fr', 'es']).optional(),
  agent: z
    .looseObject({
      mode: z.enum(['query', 'auto', 'manual']).optional(),
      useCdp: z.boolean().optional(),
      maxSteps: z.number().int().min(5).max(100).optional(),
      notifications: z.boolean().optional(),
      screenshots: z.enum(['auto', 'main', 'vision']).optional(),
      autoScreenshot: z.boolean().optional(),
    })
    .optional(),
  sitePolicies: z.record(z.string(), z.enum(['blocked', 'readOnly', 'confirmEach', 'confirmRisky', 'auto'])).optional(),
  checkUpdates: z.boolean().optional(),
});

const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const messageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string().optional(),
  contexts: z
    .array(
      z.object({
        kind: z.enum(['page', 'selection']),
        title: z.string(),
        url: z.string(),
        content: z.string(),
        truncated: z.boolean(),
        capturedAt: z.number(),
      }),
    )
    .optional(),
  status: z.enum(['done', 'error', 'aborted']),
  error: errorInfo.optional(),
  model: modelRef.optional(),
  usage,
  taskId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Run records are shown as stored; only the fields the panel relies on are checked. */
const taskSchema = z.looseObject({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  anchorMessageId: z.string(),
  status: z.enum(['running', 'paused', 'waiting', 'done', 'failed', 'stopped']),
  steps: z.array(
    z.looseObject({
      index: z.number(),
      actions: z.array(
        z.looseObject({
          id: z.string(),
          tool: z.string(),
          args: z.record(z.string(), z.unknown()),
          risk: z.number(),
          status: z.enum(['running', 'awaiting', 'done', 'error', 'rejected', 'skipped']),
        }),
      ),
    }),
  ),
  draft: z.string(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }),
  model: modelRef,
  mode: z.enum(['query', 'auto', 'manual']),
  startTabId: z.number(),
  maxSteps: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const backupSchema = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.number(),
  settings: settingsSchema.optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  conversations: z.array(conversationSchema).optional(),
  messages: z.array(messageSchema).optional(),
  tasks: z.array(taskSchema).optional(),
});

const encryptedSchema = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.number(),
  encrypted: z.object({
    cipher: z.literal('AES-256-GCM'),
    kdf: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(MIN_KDF_ITERATIONS).max(MAX_KDF_ITERATIONS),
    salt: z.string().min(1),
    iv: z.string().min(1),
    data: z.string().min(1),
  }),
});

/** A backup locked with a password: only where it comes from and when is readable. */
export interface EncryptedBackup {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  encrypted: Sealed;
}

export interface Backup {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  settings?: Settings;
  /** API keys by connection id; present only when the user chose to include them. */
  secrets?: Record<string, string>;
  conversations?: ConversationRecord[];
  messages?: MessageRecord[];
  tasks?: AgentTask[];
}

export async function buildBackup({ includeKeys, includeConversations = true }: { includeKeys: boolean; includeConversations?: boolean }): Promise<Backup> {
  const backup: Backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: await loadSettings(),
    ...(includeKeys ? { secrets: await loadSecrets() } : {}),
  };
  if (!includeConversations) return backup;
  const conversations = (await db.conversations.toArray()).filter((c) => !c.deletedAt);
  const kept = new Set(conversations.map((c) => c.id));
  const messages = (await db.messages.toArray()).filter((m) => !m.deletedAt && kept.has(m.conversationId));
  const tasks = (await db.tasks.toArray()).filter((task) => !task.discardedAt && kept.has(task.conversationId));
  return { ...backup, conversations, messages, tasks };
}

/**
 * The text of a backup file. With a password the backup is encrypted; API keys
 * are written only then.
 */
export async function serializeBackup(backup: Backup, password?: string): Promise<string> {
  if (!password) {
    if (backup.secrets) throw new Error('API keys are exported only in an encrypted backup.');
    return JSON.stringify(backup, null, 2);
  }
  const file: EncryptedBackup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    encrypted: await seal(JSON.stringify(backup), password),
  };
  return JSON.stringify(file, null, 2);
}

/** Reads a backup file. Throws when it is not one. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  return backupSchema.parse(data) as unknown as Backup;
}

/** Reads a backup file that may be encrypted. Throws when it is neither kind. */
export function readBackupFile(text: string): { backup: Backup } | { encrypted: EncryptedBackup } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (typeof data === 'object' && data !== null && 'encrypted' in data) return { encrypted: encryptedSchema.parse(data) };
  return { backup: backupSchema.parse(data) as unknown as Backup };
}

/** Opens an encrypted backup. Throws WrongPasswordError when the password does not fit. */
export async function decryptBackup(file: EncryptedBackup, password: string): Promise<Backup> {
  return parseBackup(await unseal(file.encrypted, password));
}

export interface RestoreSummary {
  settings: boolean;
  keys: number;
  conversations: number;
}

/**
 * Applies a backup: its settings replace the current ones, its conversations
 * are added to those already here.
 *
 * A stored API key is kept only for a connection whose address stays the
 * same. Otherwise a crafted file could point an existing connection at
 * another server and have your key sent there.
 */
export async function restoreBackup(backup: Backup): Promise<RestoreSummary> {
  const summary: RestoreSummary = { settings: false, keys: 0, conversations: 0 };

  if (backup.settings) {
    const current = await loadSettings();
    const stored = await loadSecrets();
    const next = withDefaults(backup.settings);
    const secrets: Record<string, string> = {};
    const sameAddress = (a: string, b: string) => normalizeBaseURL(a).toLowerCase() === normalizeBaseURL(b).toLowerCase();
    for (const connection of next.connections) {
      const before = current.connections.find((c) => c.id === connection.id);
      const imported = backup.secrets?.[connection.id];
      if (imported) secrets[connection.id] = imported;
      else if (before && sameAddress(before.baseURL, connection.baseURL) && stored[connection.id]) secrets[connection.id] = stored[connection.id]!;
    }
    // Search keys go to fixed services, whatever the file says.
    for (const [id, key] of Object.entries({ ...stored, ...backup.secrets })) {
      if (id.startsWith('search:') && key) secrets[id] = key;
    }
    summary.keys = Object.keys(backup.secrets ?? {}).filter((id) => secrets[id] === backup.secrets![id]).length;
    await replaceSettings(next, secrets);
    summary.settings = true;
  }

  const conversations = backup.conversations ?? [];
  if (conversations.length > 0) {
    const ids = new Set(conversations.map((c) => c.id));
    const now = Date.now();
    await db.transaction('rw', db.conversations, db.messages, db.tasks, async () => {
      await db.conversations.bulkPut(conversations);
      await db.messages.bulkPut((backup.messages ?? []).filter((m) => ids.has(m.conversationId)));
      await db.tasks.bulkPut(
        (backup.tasks ?? [])
          .filter((task) => ids.has(task.conversationId))
          // A turn that was running when the backup was made is not running here.
          .map((task) => (ACTIVE_STATUSES.includes(task.status) ? { ...task, status: 'stopped' as const, waiting: undefined, updatedAt: now } : task)),
      );
    });
    summary.conversations = conversations.length;
  }
  return summary;
}

/** Hands the text of a backup file to the browser as a download. */
export function downloadBackup(text: string, exportedAt: number): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `browser-helper-lite-${new Date(exportedAt).toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks the background to erase stored data; see DataClearRequest. */
export async function clearData(scope: 'conversations' | 'everything'): Promise<boolean> {
  const result = (await browser.runtime.sendMessage({ type: 'data.clear', scope })) as { ok?: boolean } | undefined;
  return Boolean(result?.ok);
}
