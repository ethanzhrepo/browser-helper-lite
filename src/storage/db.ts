import Dexie, { type Table } from 'dexie';
import { monotonicFactory } from 'ulid';
import type { ReplyPicture } from '../agent/pictures';
import { ACTIVE_STATUSES, type AgentTask, type StepShot } from '../agent/types';
import type { ConversationRecord, MessageRecord } from '../shared/types';
import type { InstalledSkill } from '../skills/skills';
import type { Watch } from '../watch/watch';

class HelperDatabase extends Dexie {
  conversations!: Table<ConversationRecord, string>;
  messages!: Table<MessageRecord, string>;
  tasks!: Table<AgentTask, string>;
  /** Pictures of the page before each step of a task, for the replay. */
  shots!: Table<StepShot, string>;
  /** Pages the assistant looks at again and again for the user (see watch.ts). */
  watches!: Table<Watch, string>;
  /** Small copies of the pictures shown in replies (see pictures.ts). */
  pictures!: Table<ReplyPicture, string>;
  /** Skills the user installed or wrote, by name (see skills/store.ts). */
  skills!: Table<InstalledSkill, string>;

  constructor() {
    super('browser-helper');
    this.version(1).stores({
      conversations: 'id, updatedAt',
      messages: 'id, conversationId',
    });
    this.version(2).stores({
      tasks: 'id, conversationId, status',
    });
    this.version(3).stores({
      shots: 'id, taskId, conversationId',
      watches: 'id, status',
    });
    this.version(4).stores({
      pictures: 'id, conversationId',
    });
    this.version(5).stores({
      skills: 'name',
    });
  }
}

export const db = new HelperDatabase();

// Monotonic so messages created within the same millisecond keep their order.
const ulid = monotonicFactory();

export const newId = (): string => ulid();

const TITLE_MAX = 60;

export function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? '';
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
}

export async function createConversation(title: string): Promise<ConversationRecord> {
  const now = Date.now();
  const conversation: ConversationRecord = { id: ulid(), title, createdAt: now, updatedAt: now };
  await db.conversations.add(conversation);
  return conversation;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await db.conversations.update(id, { title });
}

export type NewMessage = Omit<MessageRecord, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Appends a message (never edits one) and bumps the conversation's updatedAt.
 * A reply that arrives after its conversation was erased is dropped.
 */
export async function appendMessage(message: NewMessage): Promise<MessageRecord> {
  const now = Date.now();
  const record: MessageRecord = { ...message, id: ulid(), createdAt: now, updatedAt: now };
  await db.transaction('rw', db.conversations, db.messages, async () => {
    if ((await db.conversations.get(message.conversationId))?.purgedAt) return;
    await db.messages.add(record);
    await db.conversations.update(message.conversationId, { updatedAt: now });
  });
  return record;
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const all = await db.conversations.orderBy('updatedAt').reverse().toArray();
  return all.filter((c) => !c.deletedAt);
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const conversation = await db.conversations.get(id);
  return conversation?.deletedAt ? undefined : conversation;
}

/** Messages in creation order; ULIDs sort by time. */
export async function getMessages(conversationId: string): Promise<MessageRecord[]> {
  const messages = await db.messages.where('conversationId').equals(conversationId).toArray();
  return messages.filter((m) => !m.deletedAt).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 90;

/**
 * Conversations whose messages contain the text, each with the first matching
 * passage. Attached pages are not searched: only what you and the assistant wrote.
 */
export async function searchMessages(query: string): Promise<Map<string, string>> {
  const q = query.trim().toLowerCase();
  const found = new Map<string, string>();
  if (!q) return found;
  await db.messages.each((message) => {
    if (message.deletedAt || found.has(message.conversationId)) return;
    const at = message.content.toLowerCase().indexOf(q);
    if (at < 0) return;
    const from = Math.max(0, at - SNIPPET_BEFORE);
    const passage = message.content.slice(from, from + SNIPPET_LENGTH).replace(/\s+/g, ' ').trim();
    found.set(message.conversationId, `${from > 0 ? '…' : ''}${passage}${from + SNIPPET_LENGTH < message.content.length ? '…' : ''}`);
  });
  return found;
}

/**
 * Deleting happens in two steps, so it can be undone for a moment: this hides
 * the conversation, and purgeConversation then erases what it held.
 */
export async function deleteConversation(id: string): Promise<void> {
  const now = Date.now();
  await db.conversations.update(id, { deletedAt: now, updatedAt: now });
}

/** Undoes deleteConversation. Resolves false when the conversation was already erased. */
export async function restoreConversation(id: string): Promise<boolean> {
  return db.transaction('rw', db.conversations, async () => {
    const conversation = await db.conversations.get(id);
    if (!conversation || conversation.purgedAt) return false;
    const { deletedAt: _deletedAt, ...rest } = conversation;
    await db.conversations.put({ ...rest, updatedAt: Date.now() });
    return true;
  });
}

/**
 * Erases a deleted conversation's messages (with the pages attached to them)
 * and its task records. Only an empty marker stays: its id and when it was
 * deleted, so a later sync can pass the deletion on.
 */
export async function purgeConversation(id: string): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, db.tasks, db.shots, db.pictures, async () => {
    const conversation = await db.conversations.get(id);
    if (!conversation?.deletedAt || conversation.purgedAt) return;
    await db.messages.where('conversationId').equals(id).delete();
    await db.tasks.where('conversationId').equals(id).delete();
    await db.shots.where('conversationId').equals(id).delete();
    await db.pictures.where('conversationId').equals(id).delete();
    await db.conversations.update(id, { title: '', purgedAt: Date.now() });
  });
}

/** How long a deleted conversation is left alone, in case a panel still offers to undo it. */
export const PURGE_GRACE_MS = 60_000;

/** Erases deleted conversations whose panel went away before it could (run when the extension starts). */
export async function purgeDeleted(now = Date.now()): Promise<number> {
  const pending = await db.conversations.filter((c) => Boolean(c.deletedAt) && !c.purgedAt && c.deletedAt! <= now - PURGE_GRACE_MS).primaryKeys();
  for (const id of pending) await purgeConversation(id);
  return pending.length;
}

/**
 * Removes a message and everything after it, for a new reply or an edited
 * request. `keepFirst` keeps the message itself (the request to answer again).
 * The removed messages are emptied at once; their turns' records keep only
 * what is needed to give back the tabs they grouped.
 */
export async function truncateConversation(conversationId: string, fromMessageId: string, { keepFirst = false } = {}): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.conversations, db.messages, db.tasks, db.shots, db.pictures, async () => {
    await db.messages
      .where('conversationId')
      .equals(conversationId)
      .filter((m) => !m.deletedAt && (keepFirst ? m.id > fromMessageId : m.id >= fromMessageId))
      .modify((m) => {
        m.content = '';
        m.deletedAt = now;
        m.updatedAt = now;
        delete m.reasoning;
        delete m.contexts;
        delete m.images;
        delete m.command;
        delete m.skills;
        delete m.tab;
        delete m.error;
        delete m.usage;
      });
    const replaced = db.tasks
      .where('conversationId')
      .equals(conversationId)
      .filter((task) => !task.discardedAt && task.anchorMessageId >= fromMessageId);
    await db.shots.where('taskId').anyOf(await replaced.primaryKeys()).delete();
    await replaced
      .modify((task) => {
        task.discardedAt = now;
        task.updatedAt = now;
        task.goal = '';
        task.steps = [];
        task.draft = '';
        delete task.result;
        delete task.error;
        delete task.waiting;
        delete task.injection;
      });
    await db.conversations.update(conversationId, { updatedAt: now });
  });
}

/** Erases every conversation, message and task record. */
export async function clearConversations(): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, db.tasks, db.shots, db.pictures, async () => {
    await Promise.all([db.conversations.clear(), db.messages.clear(), db.tasks.clear(), db.shots.clear(), db.pictures.clear()]);
  });
}

/** Agent tasks are mutable run records (unlike messages); the final summary is appended as a message. */
export async function saveTask(task: AgentTask): Promise<void> {
  await db.transaction('rw', db.conversations, db.tasks, async () => {
    // A turn that was still stopping when its conversation was erased leaves nothing behind.
    if ((await db.conversations.get(task.conversationId))?.purgedAt) return;
    await db.tasks.put(task);
  });
}

/** Stores a replay picture, unless its conversation was erased meanwhile. */
export async function saveShot(shot: StepShot): Promise<void> {
  await db.transaction('rw', db.conversations, db.shots, async () => {
    if ((await db.conversations.get(shot.conversationId))?.purgedAt) return;
    await db.shots.put(shot);
  });
}

/** Stores a reply's picture, unless its conversation was erased meanwhile. */
export async function savePicture(picture: ReplyPicture): Promise<void> {
  await db.transaction('rw', db.conversations, db.pictures, async () => {
    if ((await db.conversations.get(picture.conversationId))?.purgedAt) return;
    await db.pictures.put(picture);
  });
}

/** A task's replay pictures, in the order of its steps. */
export async function getShots(taskId: string): Promise<StepShot[]> {
  return (await db.shots.where('taskId').equals(taskId).toArray()).sort((a, b) => a.step - b.step);
}

/** A conversation's turns. Discarded ones (replaced by a new reply) are only wanted for the tabs they grouped. */
export async function getTasks(conversationId: string, { discarded = false } = {}): Promise<AgentTask[]> {
  const tasks = await db.tasks.where('conversationId').equals(conversationId).toArray();
  return discarded ? tasks : tasks.filter((task) => !task.discardedAt);
}

/** A service worker restart loses running tasks; mark them as stopped. */
export async function markInterruptedTasks(): Promise<AgentTask[]> {
  const interrupted = await db.tasks.where('status').anyOf(ACTIVE_STATUSES).toArray();
  const now = Date.now();
  for (const task of interrupted) {
    await db.tasks.update(task.id, {
      status: 'stopped',
      waiting: undefined,
      error: { code: 'unknown', message: 'Interrupted: the extension was restarted.' },
      updatedAt: now,
    });
  }
  return interrupted;
}
