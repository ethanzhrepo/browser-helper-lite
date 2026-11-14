import { browser } from 'wxt/browser';

/**
 * An extension loaded unpacked is never updated by Chrome, so it asks GitHub
 * for the latest release itself: one request without cookies or any data
 * about you, at most once a day, and only if the setting is on.
 */
export const REPO_URL = 'https://github.com/ethanzhrepo/browser-helper-lite';
const LATEST_RELEASE_API = 'https://api.github.com/repos/ethanzhrepo/browser-helper-lite/releases/latest';
const STATE_KEY = 'update:v1';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  checkedAt: number;
  /** The newest release, e.g. "0.2.0". Missing when the last check failed. */
  latest?: string;
  /** Its release page. */
  url?: string;
  failed?: boolean;
  /** The version the user closed the side panel's notice for. */
  dismissed?: string;
}

const parts = (version: string) => version.replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);

/** True when version `a` is newer than `b` ("0.10.0" is newer than "0.9.1"). */
export function isNewer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** The newer version to offer, if the last check found one. */
export function availableUpdate(state: UpdateState | undefined, current: string): { version: string; url: string } | undefined {
  if (!state?.latest || !isNewer(state.latest, current)) return undefined;
  return { version: state.latest, url: state.url ?? `${REPO_URL}/releases/latest` };
}

export async function loadUpdateState(): Promise<UpdateState | undefined> {
  return (await browser.storage.local.get(STATE_KEY))[STATE_KEY] as UpdateState | undefined;
}

async function saveUpdateState(state: UpdateState): Promise<UpdateState> {
  await browser.storage.local.set({ [STATE_KEY]: state });
  return state;
}

export function watchUpdateState(listener: (state: UpdateState | undefined) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STATE_KEY in changes) listener(changes[STATE_KEY]!.newValue as UpdateState | undefined);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** Asks GitHub for the latest release and stores the answer. Never throws. */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<UpdateState> {
  const previous = await loadUpdateState();
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const latest = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : '';
    if (!/^\d+(\.\d+){1,3}$/.test(latest)) throw new Error('Unexpected release name');
    // Only ever link to this project's own release pages.
    const url = typeof release.html_url === 'string' && release.html_url.startsWith(`${REPO_URL}/releases/`) ? release.html_url : `${REPO_URL}/releases/latest`;
    return await saveUpdateState({ checkedAt: now, latest, url, dismissed: previous?.dismissed });
  } catch (error) {
    console.warn('Update check failed', error);
    return saveUpdateState({ ...previous, checkedAt: now, failed: true });
  }
}

/** The automatic check: skipped when one ran within the last day. */
export async function checkForUpdateIfDue(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<void> {
  const state = await loadUpdateState();
  if (state && now - state.checkedAt < CHECK_INTERVAL_MS) return;
  await checkForUpdate(fetchImpl, now);
}

export async function dismissUpdate(version: string): Promise<void> {
  const state = await loadUpdateState();
  if (state) await saveUpdateState({ ...state, dismissed: version });
}

/** Chrome updates store installs by itself. */
export function updatedByChrome(): boolean {
  return Boolean((browser.runtime.getManifest() as { update_url?: string }).update_url);
}
