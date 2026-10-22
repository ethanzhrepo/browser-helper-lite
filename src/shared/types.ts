export type Vendor = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'openai-compatible';

/** Capability slots (§5.1). Agent and vision are configured now and used from M1. */
export type Capability = 'chat' | 'fast' | 'agent' | 'vision';

export type Locale = 'zh-CN' | 'en' | 'fr' | 'es';
export type LanguageSetting = 'auto' | Locale;

/** A vendor + endpoint + key. The key itself lives in the secrets store. */
export interface Connection {
  id: string;
  vendor: Vendor;
  /** Preset id for OpenAI-compatible connections (e.g. "ollama"). */
  presetId?: string;
  name: string;
  baseURL: string;
  /** Model ids returned by the last successful model listing. */
  models: string[];
  modelsFetchedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModelRef {
  connectionId: string;
  modelId: string;
}

export interface SlotAssignment extends ModelRef {
  temperature?: number;
}

export interface Settings {
  schemaVersion: 1;
  connections: Connection[];
  slots: Partial<Record<Capability, SlotAssignment>>;
  language: LanguageSetting;
  updatedAt: number;
}

export type ErrorCode =
  | 'auth'
  | 'forbidden'
  | 'notFound'
  | 'rateLimit'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'noModel'
  | 'noKey'
  | 'unknown';

export interface ErrorInfo {
  code: ErrorCode;
  /** Raw detail from the provider, shown under the localized summary. */
  message: string;
  status?: number;
}

export type ContextKind = 'page' | 'selection';

/** Page content or selection captured at send time and stored with the message. */
export interface ContextSnapshot {
  kind: ContextKind;
  title: string;
  url: string;
  content: string;
  truncated: boolean;
  capturedAt: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'done' | 'error' | 'aborted';

/**
 * Messages are append-only: once written they are never edited, only
 * tombstoned via `deletedAt`. This keeps Drive sync a simple union (§9.4).
 */
export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  contexts?: ContextSnapshot[];
  status: MessageStatus;
  error?: ErrorInfo;
  model?: ModelRef;
  usage?: Usage;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
