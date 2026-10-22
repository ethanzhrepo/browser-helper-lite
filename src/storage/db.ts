import Dexie, { type Table } from 'dexie';
import { monotonicFactory } from 'ulid';
import { ACTIVE_STATUSES, type AgentTask } from '../agent/types';
import type { ConversationRecord, MessageRecord } from '../shared/types';

class HelperDatabase extends Dexie {
  conversations!: Table<ConversationRecord, string>;
  messages!: Table<MessageRecord, string>;
  tasks!: Table<AgentTask, string>;

  constructor() {
    super('browser-helper');
    this.version(1).stores({
      conversations: 'id, updatedAt',
      messages: 'id, conversationId',
    });
    this.version(2).stores({
      tasks: 'id, conversationId, status',
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

export type NewMessage = Omit<MessageRecord, 'id' | 'createdAt' | 'updatedAt'>;

/** Appends a message (never edits one) and bumps the conversation's updatedAt. */
export async function appendMessage(message: NewMessage): Promise<MessageRecord> {
  const now = Date.now();
  const record: MessageRecord = { ...message, id: ulid(), createdAt: now, updatedAt: now };
  await db.transaction('rw', db.conversations, db.messages, async () => {
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

/** Tombstones the conversation so the deletion can be synced later. */
export async function deleteConversation(id: string): Promise<void> {
  const now = Date.now();
  await db.conversations.update(id, { deletedAt: now, updatedAt: now });
}

/** Agent tasks are mutable run records (unlike messages); the final summary is appended as a message. */
export async function saveTask(task: AgentTask): Promise<void> {
  await db.tasks.put(task);
}

export async function getTasks(conversationId: string): Promise<AgentTask[]> {
  return db.tasks.where('conversationId').equals(conversationId).toArray();
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
