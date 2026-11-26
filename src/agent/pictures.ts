import { urlDataLeak } from './injection';

/**
 * Pictures in replies (a product's photo next to its price).
 *
 * The panel never loads an address that a reply names: a reply shaped by a
 * malicious page could put the user's data into an image address, and loading
 * it would hand the data over. So:
 * - only an address that was, as it stands, in what the assistant read during
 *   the task (pages, search results, what the user attached) is fetched: the
 *   model can pass such an address on, it cannot write one;
 * - the extension fetches it, without cookies and without saying which page
 *   it came from, and keeps a small copy with the conversation;
 * - the panel shows that copy. Its own content policy still forbids it to
 *   load anything from the network.
 * What is left to a page: choosing which of the addresses it showed gets
 * fetched, which says a few bits at most. The number per reply is limited.
 */
export interface ReplyPicture {
  /** `pictureId(conversationId, url)`. */
  id: string;
  conversationId: string;
  /** Where it came from, normalized (see `pictureKey`). */
  url: string;
  /** Base64. */
  image: string;
  mediaType: string;
  width: number;
  height: number;
  at: number;
  /** Not fetched yet: the server lets the extension read it only with access to its site, which the user may give (see keep-pictures.ts). `image` is empty. */
  pending?: boolean;
}

export const MAX_REPLY_PICTURES = 8;
const MAX_ADDRESS_CHARS = 600;
const MAX_BYTES = 5_000_000;
const MAX_SIDE = 480;
const MIN_SIDE = 24;
const FETCH_MS = 8000;

/** An address in the one spelling it is compared and stored by. */
export function pictureKey(url: string): string {
  try {
    return new URL(url.trim()).href;
  } catch {
    return url.trim();
  }
}

export const pictureId = (conversationId: string, url: string) => `${conversationId} ${pictureKey(url)}`;

/** Every web address in a text. */
export function addressesIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'`\\)\]]+/gi) ?? []).map((address) => address.replace(/[.,;:!?…]+$/, ''));
}

/** The addresses of the pictures a reply shows (Markdown images), in order, each once. */
export function replyPictures(reply: string): string[] {
  const found = new Set<string>();
  for (const match of reply.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) found.add(match[1]!);
  return [...found];
}

/** Those of a reply's pictures that may be fetched: addresses the assistant read, that carry no credentials or data. `seen` holds picture keys. */
export function allowedPictures(reply: string, seen: ReadonlySet<string>, limit = MAX_REPLY_PICTURES): string[] {
  return replyPictures(reply)
    .filter((url) => {
      if (url.length > MAX_ADDRESS_CHARS) return false;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return false;
      return seen.has(pictureKey(url)) && !['email', 'card', 'secret'].includes(urlDataLeak(url) ?? '');
    })
    .slice(0, limit);
}

/**
 * The pictures a page's text names, as Markdown: the product's own first
 * (the "Picture:" line of its data), then those in the text. For notes on a
 * page, which would otherwise lose them.
 */
export function picturesIn(text: string, limit = 3): string[] {
  const found = new Map<string, string>();
  const lead = /^- Picture: (https?:\/\/\S+)$/m.exec(text);
  if (lead) found.set(lead[1]!, `![](${lead[1]})`);
  for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?[^)]*\)/g)) {
    if (!found.has(match[2]!)) found.set(match[2]!, `![${match[1]}](${match[2]})`);
  }
  return [...found.values()].slice(0, limit);
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Fetches a picture and makes the small copy that is kept. Undefined when it
 * is not a picture, is too large, or is so small that it is not there to be
 * looked at. Throws when the server cannot be reached or does not let the
 * extension read it.
 */
export async function fetchPicture(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Pick<ReplyPicture, 'image' | 'mediaType' | 'width' | 'height'> | undefined> {
  const timeout = AbortSignal.timeout(FETCH_MS);
  const response = await fetchImpl(url, {
    // No cookies, and no word of which page the address was on.
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) return undefined;
  if (!/^image\/(jpeg|png|webp|gif|avif)\b/i.test(response.headers.get('content-type') ?? '')) return undefined;
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return undefined;
  const blob = await response.blob();
  if (blob.size > MAX_BYTES) return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < MIN_SIDE || bitmap.height < MIN_SIDE) return undefined;
    const shrink = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * shrink));
    const height = Math.max(1, Math.round(bitmap.height * shrink));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    // WebP keeps a transparent background, which product photos often have.
    return { image: await toBase64(await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })), mediaType: 'image/webp', width, height };
  } finally {
    bitmap.close();
  }
}
