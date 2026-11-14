import type { SearchResult } from '../agent/page/types';
import type { ErrorInfo, SearchProviderId, Vendor } from './types';

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

/** Runs a search with the saved settings of an API provider (the options page's test button). */
export interface SearchTestRequest {
  type: 'search.test';
  provider: SearchProviderId;
  query: string;
}

export interface SearchTestResult {
  ok: boolean;
  results: SearchResult[];
  /** Built-in model search answers in text. */
  text?: string;
  error?: ErrorInfo;
}

/** Recorded speech for the speech-to-text model (M1.5 C7). */
export interface TranscribeRequest {
  type: 'stt.transcribe';
  /** Base64 audio. */
  audio: string;
  mediaType: string;
  /** BCP 47 language tag, if known. */
  language?: string;
}

export interface TranscribeResult {
  ok: boolean;
  text: string;
  error?: ErrorInfo;
}

/**
 * Erases stored data (the settings page's Data section). Done in the
 * background, which first stops the turns that would write more.
 * - conversations: every conversation, message and task record
 * - everything: also settings, API keys, site rules and granted site access
 */
export interface DataClearRequest {
  type: 'data.clear';
  scope: 'conversations' | 'everything';
}

export interface DataClearResult {
  ok: boolean;
}

/**
 * A screenshot of a tab's viewport, for the part of it the user marked. Taken
 * in the background: when Chrome does not let the extension capture the tab
 * (no access to all sites), the debugger does it.
 */
export interface RegionCaptureRequest {
  type: 'region.capture';
  tabId: number;
}

export interface RegionCaptureResult {
  ok: boolean;
  /** Base64. */
  image?: string;
  mediaType?: 'image/png' | 'image/jpeg';
}

/** Something the user does to a watch in the panel; done in the background, which holds the timers. */
export type WatchActionRequest = { type: 'watch.action'; id: string } & (
  | { action: 'check' | 'pause' | 'resume' | 'delete' }
  /** How often to look, in seconds. */
  | { action: 'interval'; seconds: number }
);

export interface WatchActionResult {
  ok: boolean;
}

export type RuntimeRequest = ConnectionTestRequest | SearchTestRequest | TranscribeRequest | DataClearRequest | RegionCaptureRequest;
