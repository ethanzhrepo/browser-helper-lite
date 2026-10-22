import type { TFunction } from 'i18next';
import type { ErrorInfo } from '../shared/types';

/** Localized one-line summary for an error; the raw detail is shown separately. */
export function errorSummary(t: TFunction, error: ErrorInfo): string {
  return t(`errors.${error.code}`, { status: error.status ?? '' });
}

/** Errors the user fixes in settings rather than by retrying. */
export function isSettingsError(error: ErrorInfo): boolean {
  return error.code === 'auth' || error.code === 'noKey' || error.code === 'noModel' || error.code === 'forbidden';
}
