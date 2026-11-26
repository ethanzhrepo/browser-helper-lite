import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { ReplyPicture } from '../agent/pictures';
import { MAX_SOCIAL_PAGES, MAX_SOCIAL_SITES } from '../agent/social';
import { ACTIVE_STATUSES, type AgentTask, type StepShot } from '../agent/types';
import { isLoopbackHost, normalizeBaseURL } from '../providers/vendors';
import type { ConversationRecord, MessageRecord, Settings } from '../shared/types';
import {
  MAX_INSTALLED_SKILLS,
  MAX_SKILL_FILES,
  SKILL_COMPATIBILITY_CHARS,
  SKILL_DESCRIPTION_CHARS,
  SKILL_FILE_BYTES,
  SKILL_INSTRUCTION_CHARS,
  SKILL_NAME_CHARS,
  type InstalledSkill,
  type LegacySkill,
} from '../skills/skills';
import { keepLegacySkills, listInstalledSkills, restoreSkills } from '../skills/store';
import { MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, seal, unseal, type Sealed } from './backup-crypto';
import { db } from './db';
import { loadSecrets, loadSettings, MAX_MAX_STEPS, MIN_MAX_STEPS, replaceSettings, withDefaults } from './settings';

// Zod's JIT uses eval, which the extension's CSP forbids.
z.config({ jitless: true });

/**
 * A backup file: settings and, when asked for, conversations and API keys.
 * With a password it is encrypted (see backup-crypto.ts); without one it is
 * plain JSON that anyone who gets the file can read, so it never holds keys.
 */
export const BACKUP_APP = 'browser-helper-lite';
export const BACKUP_VERSION = 1;

const usage = z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), cachedTokens: z.number().optional() }).optional();
const modelRef = z.object({ connectionId: z.string(), modelId: z.string() });
const errorInfo = z.object({ code: z.string(), message: z.string(), status: z.number().optional() });

const connectionSchema = z.looseObject({
  id: z.string().min(1),
  vendor: z.enum(['openai', 'anthropic', 'google', 'deepseek', 'openai-compatible']),
  name: z.string(),
  baseURL: z.string(),
  models: z.array(z.string()),
});

const savedCommand = z.object({ name: z.string().min(1).max(64), steps: z.array(z.string().max(400)).max(100), startUrl: z.string().optional() });

const slotSchema = z.object({ connectionId: z.string(), modelId: z.string(), temperature: z.number().optional() });

const safeCustomSearchUrl = z.string().max(1000).refine((value) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed.replace(/%s/g, 'test'));
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  } catch {
    return false;
  }
}, 'Custom search URL must use https (or http on localhost)');

/** Checked where a wrong value could do harm or break the pages; unknown fields pass, older ones are migrated on load. */
const settingsSchema = z.looseObject({
  connections: z.array(connectionSchema),
  slots: z.record(z.string(), slotSchema).optional(),
  language: z.enum(['auto', 'zh-CN', 'en', 'fr', 'es']).optional(),
  region: z.string().regex(/^(auto|none|[A-Z]{2})$/).optional(),
  agent: z
    .looseObject({
      mode: z.enum(['query', 'auto', 'manual']).optional(),
      reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high']).optional(),
      useCdp: z.boolean().optional(),
      maxSteps: z.number().int().min(MIN_MAX_STEPS).max(MAX_MAX_STEPS).optional(),
      notifications: z.boolean().optional(),
      screenshots: z.enum(['auto', 'main', 'vision']).optional(),
      visionStrategy: z.enum(['off', 'auto', 'always']).optional(),
      autoScreenshot: z.boolean().optional(),
      customSearchUrl: safeCustomSearchUrl.optional(),
    })
    .optional(),
  search: z
    .looseObject({
      provider: z.enum(['browser', 'deepseek', 'cloudflare', 'tavily', 'brave', 'exa', 'native']).optional(),
      engine: z.enum(['google', 'bing', 'duckduckgo', 'custom']).optional(),
      customUrl: safeCustomSearchUrl.optional(),
      deepseekQuestion: z.boolean().optional(),
      deepseekFetch: z.boolean().optional(),
      fallbackToBrowser: z.boolean().optional(),
    })
    .optional(),
  sitePolicies: z.record(z.string(), z.enum(['blocked', 'readOnly', 'confirmEach', 'confirmRisky', 'auto'])).optional(),
  skills: z
    .object({
      off: z.array(z.string().max(SKILL_NAME_CHARS)).max(200),
      // Saved by 0.3.0, which kept installed skills in the settings.
      installed: z.array(z.object({ name: z.string().min(1).max(SKILL_NAME_CHARS), description: z.string().max(SKILL_DESCRIPTION_CHARS), instructions: z.string().max(SKILL_INSTRUCTION_CHARS) })).max(MAX_INSTALLED_SKILLS).optional(),
    })
    .optional(),
  social: z
    .object({
      added: z.array(z.string().max(253)).max(MAX_SOCIAL_SITES),
      removed: z.array(z.string().max(253)).max(MAX_SOCIAL_SITES),
      pages: z.number().int().min(1).max(MAX_SOCIAL_PAGES),
    })
    .optional(),
  commands: z.array(savedCommand.extend({ id: z.string().min(1), prompt: z.string(), createdAt: z.number() })).optional(),
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
  images: z
    .array(
      z.object({
        // Shown as an image and sent to the model as one: nothing else may be in it.
        data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
        mediaType: z.literal('image/jpeg'),
        width: z.number(),
        height: z.number(),
        url: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional(),
  command: savedCommand.optional(),
  skills: z.array(z.string().max(SKILL_NAME_CHARS)).max(10).optional(),
  tab: z.object({ title: z.string(), url: z.string() }).optional(),
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
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), cachedTokens: z.number().optional() }),
  model: modelRef,
  mode: z.enum(['query', 'auto', 'manual']),
  startTabId: z.number(),
  maxSteps: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** An installed skill as a backup holds it; restoring checks it again as an installed one (see restoreSkills). */
const installedSkillSchema = z.object({
  name: z.string().min(1).max(SKILL_NAME_CHARS),
  description: z.string().max(SKILL_DESCRIPTION_CHARS),
  instructions: z.string().max(SKILL_INSTRUCTION_CHARS),
  license: z.string().max(500).optional(),
  compatibility: z.string().max(SKILL_COMPATIBILITY_CHARS).optional(),
  metadata: z.record(z.string().max(64), z.string().max(1000)).optional(),
  allowedTools: z.string().max(1000).optional(),
  files: z.array(z.object({ path: z.string().min(1).max(300), text: z.string().max(SKILL_FILE_BYTES) })).max(MAX_SKILL_FILES).optional(),
  skipped: z.array(z.object({ path: z.string().max(300), reason: z.enum(['script', 'binary', 'large', 'many']) })).max(500).optional(),
  installedAt: z.number(),
  updatedAt: z.number(),
  source: z.string().max(2000).optional(),
});

const pictureSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  url: z.string().max(2000).regex(/^https?:\/\//i),
  // Shown as an image: nothing else may be in it. Empty only while it waits for access to its site.
  image: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mediaType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  width: z.number(),
  height: z.number(),
  at: z.number(),
  pending: z.boolean().optional(),
}).refine((picture) => picture.pending === true || picture.image.length > 0, 'A picture without its image');

const shotSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  step: z.number(),
  // Shown as an image: nothing else may be in it.
  image: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number(),
  height: z.number(),
  cssWidth: z.number().positive(),
  url: z.string(),
  at: z.number(),
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
  shots: z.array(shotSchema).optional(),
  pictures: z.array(pictureSchema).optional(),
  skills: z.array(installedSkillSchema).max(MAX_INSTALLED_SKILLS).optional(),
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
  /** Replay pictures of the tasks. */
  shots?: StepShot[];
  /** The pictures shown in replies. */
  pictures?: ReplyPicture[];
  /** The skills the user installed or wrote, with their files. */
  skills?: InstalledSkill[];
}

export async function buildBackup({ includeKeys, includeConversations = true }: { includeKeys: boolean; includeConversations?: boolean }): Promise<Backup> {
  const backup: Backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: await loadSettings(),
    ...(includeKeys ? { secrets: await loadSecrets() } : {}),
  };
  // Installed skills go with the settings.
  const skills = await listInstalledSkills();
  if (skills.length > 0) backup.skills = skills;
  if (!includeConversations) return backup;
  const conversations = (await db.conversations.toArray()).filter((c) => !c.deletedAt);
  const kept = new Set(conversations.map((c) => c.id));
  const messages = (await db.messages.toArray()).filter((m) => !m.deletedAt && kept.has(m.conversationId));
  const tasks = (await db.tasks.toArray()).filter((task) => !task.discardedAt && kept.has(task.conversationId));
  const taskIds = new Set(tasks.map((task) => task.id));
  const shots = (await db.shots.toArray()).filter((shot) => taskIds.has(shot.taskId));
  const pictures = (await db.pictures.toArray()).filter((picture) => kept.has(picture.conversationId));
  return { ...backup, conversations, messages, tasks, ...(shots.length ? { shots } : {}), ...(pictures.length ? { pictures } : {}) };
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
  /** Installed skills taken from the backup. */
  skills: number;
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
  const summary: RestoreSummary = { settings: false, keys: 0, conversations: 0, skills: 0 };
  let legacySkills: LegacySkill[] = [];

  if (backup.settings) {
    const current = await loadSettings();
    const stored = await loadSecrets();
    const next = withDefaults(backup.settings);
    // A backup of 0.3.0 has its installed skills in the settings; they go to the database (see below).
    legacySkills = next.skills.installed ?? [];
    next.skills = { off: next.skills.off };
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
  // Each skill is checked as one being installed would be; one that is not in shape is left out.
  summary.skills = (await restoreSkills(backup.skills ?? [])) + (await keepLegacySkills(legacySkills));

  const conversations = backup.conversations ?? [];
  if (conversations.length > 0) {
    const ids = new Set(conversations.map((c) => c.id));
    const now = Date.now();
    await db.transaction('rw', db.conversations, db.messages, db.tasks, db.shots, db.pictures, async () => {
      await db.shots.bulkPut((backup.shots ?? []).filter((shot) => ids.has(shot.conversationId)));
      // Never import pending picture placeholders from an untrusted backup: only already-cached images are restored.
      await db.pictures.bulkPut((backup.pictures ?? []).filter((picture) => ids.has(picture.conversationId) && !picture.pending && picture.image.length > 0));
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
