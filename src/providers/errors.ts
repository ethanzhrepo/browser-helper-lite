import { APICallError, RetryError } from 'ai';
import type { ErrorCode, ErrorInfo } from '../shared/types';

/** Error thrown by our own fetches (model listing). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} ${url}${body ? `: ${body.slice(0, 500)}` : ''}`);
    this.name = 'HttpError';
  }
}

export class ConfigError extends Error {
  constructor(
    readonly code: Extract<ErrorCode, 'noModel' | 'noKey' | 'insecure'>,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'badRequest';
  return 'unknown';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/** Maps any provider / network error to a serializable, localizable shape. */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (RetryError.isInstance(error)) return toErrorInfo(error.lastError);
  if (error instanceof ConfigError) return { code: error.code, message: error.message };
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    const detail = error.responseBody ? `${error.message}\n${error.responseBody.slice(0, 500)}` : error.message;
    return { code: codeForStatus(error.statusCode), message: detail, status: error.statusCode };
  }
  if (error instanceof HttpError) {
    return { code: codeForStatus(error.status), message: error.message, status: error.status };
  }
  // fetch() rejects with a TypeError on DNS, CORS, offline and refused connections.
  if (error instanceof TypeError || (APICallError.isInstance(error) && error.cause instanceof TypeError)) {
    return { code: 'network', message: messageOf(error) };
  }
  return { code: 'unknown', message: messageOf(error) };
}
