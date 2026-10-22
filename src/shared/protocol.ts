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

export type RuntimeRequest = ConnectionTestRequest | SearchTestRequest | TranscribeRequest;
