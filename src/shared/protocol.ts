import type { ErrorInfo, ModelRef, Usage, Vendor } from './types';

/** Long-lived port between the side panel and the background chat service. */
export const CHAT_PORT_NAME = 'chat';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatClientMessage =
  | {
      type: 'start';
      model: ModelRef;
      temperature?: number;
      system: string;
      messages: ChatTurn[];
    }
  | { type: 'abort' }
  /** Sent periodically while streaming so the service worker stays alive. */
  | { type: 'ping' };

export type ChatServerMessage =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done'; usage?: Usage; finishReason?: string }
  | { type: 'error'; error: ErrorInfo };

export interface ConnectionTestRequest {
  type: 'connection.test';
  vendor: Vendor;
  baseURL: string;
  /** New key typed in the form; when empty, the stored key of `connectionId` is used. */
  apiKey?: string;
  connectionId?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  models: string[];
  error?: ErrorInfo;
}

export type RuntimeRequest = ConnectionTestRequest;
