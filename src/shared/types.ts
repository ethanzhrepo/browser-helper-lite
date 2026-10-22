export type Vendor = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'openai-compatible';

/**
 * Capability slots (§5.1). `chat` is the current model, switched from the
 * side panel header; it also drives the agent.
 */
export type Capability = 'chat' | 'fast' | 'vision' | 'stt';

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
  /** Starred models; the header's model switcher shows these first. */
  favoriteModels?: string[];
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

/** Per-site agent policy (§6). Keys of `Settings.sitePolicies` are hostnames; "example.com" also covers subdomains. */
export type SitePolicy = 'blocked' | 'readOnly' | 'confirmEach' | 'confirmRisky' | 'auto';

/**
 * What the assistant may do on pages without asking (M1.5):
 * - query: read, search and follow links only; never click buttons or fill forms
 * - auto: everything, but high-risk actions (L3) need approval
 * - manual: reading, scrolling, links and searches run; every other action needs approval
 */
export type AgentMode = 'query' | 'auto' | 'manual';

export interface AgentSettings {
  mode: AgentMode;
  /** Use the CDP driver when this build has the debugger permission. */
  useCdp: boolean;
  maxSteps: number;
  /** Chrome notifications when a task needs you. */
  notifications: boolean;
}

export type SearchEngineSetting = 'google' | 'bing' | 'duckduckgo' | 'custom';

/** `browser` searches in a background tab; the others are APIs (§7.6). */
export type SearchProviderId = 'browser' | 'deepseek' | 'cloudflare' | 'tavily' | 'brave' | 'exa' | 'native';

export type CloudflareSearchSource = 'ceramic' | 'exa' | 'linkup';

export interface SearchSettings {
  provider: SearchProviderId;
  /** Engine for browser search, also the fallback when an API fails. */
  engine: SearchEngineSetting;
  /** For the custom engine; `%s` is replaced by the query. */
  customUrl: string;
  /** DeepSeek search reuses the key of a DeepSeek connection. */
  deepseekConnectionId?: string;
  cloudflare: { accountId: string; gatewayId: string; source: CloudflareSearchSource };
  /** Search in the browser when the API fails. */
  fallbackToBrowser: boolean;
}

export type VoiceEngine = 'browser' | 'stt';

export interface VoiceSettings {
  /** browser: Chrome's Web Speech API; stt: record and send to the speech-to-text model. */
  engine: VoiceEngine;
  /** BCP 47 tag such as "zh-CN", or "auto" to follow the interface language. */
  language: string;
  /** Send the message as soon as you stop speaking. */
  autoSend: boolean;
}

export interface Settings {
  schemaVersion: 1;
  connections: Connection[];
  slots: Partial<Record<Capability, SlotAssignment>>;
  language: LanguageSetting;
  agent: AgentSettings;
  search: SearchSettings;
  voice: VoiceSettings;
  sitePolicies: Record<string, SitePolicy>;
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
  /** Set on an agent goal (user) and on the task's final summary (assistant). */
  taskId?: string;
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
