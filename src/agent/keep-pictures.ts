import { hasHostAccess, originPattern } from '../permissions/hosts';
import type { SitePolicy } from '../shared/types';
import { db, savePicture } from '../storage/db';
import { fetchPicture, pictureId, pictureKey } from './pictures';
import { policyFor } from './policy';

/**
 * Keeping the pictures a reply shows (see pictures.ts for which ones may be
 * fetched at all). Runs in the background.
 *
 * Some picture servers do not let the extension read their pictures unless
 * it has access to the site. Then a placeholder is kept ("pending"), and the
 * panel offers to show the picture: the user's click asks Chrome for access
 * to that one site, and the picture is fetched as any other, by the same
 * rules. The panel itself still loads nothing from the web.
 */
export type KeepResult = 'kept' | 'needsAccess' | 'failed' | 'none';

interface KeepOptions {
  signal?: AbortSignal;
  /** Fetches and shrinks the picture (fetchPicture); replaced in tests. */
  load?: typeof fetchPicture;
  hasAccess?: (url: string) => Promise<boolean>;
}

export async function keepPicture(conversationId: string, url: string, { signal, load = fetchPicture, hasAccess = hasHostAccess }: KeepOptions = {}): Promise<KeepResult> {
  const id = pictureId(conversationId, url);
  const stored = await db.pictures.get(id);
  if (stored && !stored.pending) return 'kept';
  let picture: Awaited<ReturnType<typeof fetchPicture>>;
  try {
    picture = await load(url, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // With access to the site, more access would not help: the server is down, or refuses.
    if (await hasAccess(url).catch(() => false)) return 'failed';
    if (!stored) await savePicture({ id, conversationId, url: pictureKey(url), image: '', mediaType: 'image/webp', width: 0, height: 0, at: Date.now(), pending: true });
    return 'needsAccess';
  }
  if (!picture) {
    // Not a picture, too large or too small: nothing to show, so nothing to offer.
    if (stored) await db.pictures.delete(id);
    return 'none';
  }
  await savePicture({ id, conversationId, url: pictureKey(url), ...picture, at: Date.now() });
  return 'kept';
}

/**
 * After the user let the extension load pictures from a site: fetches the
 * pictures of that conversation that wait for the site. Only addresses the
 * background itself kept as pending can be fetched this way. True when one
 * could be shown.
 */
export async function showPendingPictures(id: string, sitePolicies: Record<string, SitePolicy>, options: Omit<KeepOptions, 'signal'> = {}): Promise<boolean> {
  const first = await db.pictures.get(id);
  if (!first?.pending) return false;
  const site = originPattern(first.url);
  if (policyFor(new URL(first.url).hostname, sitePolicies) === 'blocked') return false;
  const waiting = (await db.pictures.where('conversationId').equals(first.conversationId).toArray()).filter((picture) => picture.pending && originPattern(picture.url) === site);
  const results = await Promise.all(waiting.map((picture) => keepPicture(picture.conversationId, picture.url, options).catch((): KeepResult => 'failed')));
  return results.includes('kept');
}
