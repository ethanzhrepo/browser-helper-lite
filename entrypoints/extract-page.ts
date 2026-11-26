import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { PageExtraction } from '../src/browser/page-context';
import { describeProduct, pictureAddress, productFromJsonLd } from '../src/browser/product';
import { isInvisibleOpacity, isTransparentColor } from '../src/browser/visibility';

const HIDDEN_SAMPLE = 4000;
/** How many pictures of a page are passed on with their address, and how large one must be shown to count. */
const MAX_PICTURES = 12;
const PICTURE_SIDE = 100;

/**
 * Injected on demand with scripting.executeScript to turn the current page
 * into Markdown. Article-like pages go through Readability; app-like pages
 * (dashboards, consoles) fall back to the whole body.
 *
 * Text a person cannot see (display: none, invisible, transparent, tiny or
 * off-screen) is left out: it is a common place to hide instructions for AI
 * assistants (§8.2). A sample of it is returned so it can be checked.
 *
 * The larger pictures keep their address (a product's photo, so a reply can
 * show it); the others are named by their description only.
 */
export default defineUnlistedScript((): PageExtraction => {
  const base = { title: document.title, url: location.href, lang: document.documentElement.lang };
  // A new attribute name each run: a page cannot pre-mark visible content to hide it from the model.
  const mark = `data-bh-${Math.random().toString(36).slice(2, 10)}`;
  const textMark = `${mark}-text`;
  const { hidden: marked, textHidden } = markHidden(mark, textMark);
  // After the hidden parts are marked: a picture inside one is not passed on.
  const picture = `${mark}-picture`;
  const pictures = markPictures(picture, mark);
  let hiddenText = '';
  let clone: Document;
  try {
    clone = document.cloneNode(true) as Document;
  } finally {
    for (const el of marked) el.removeAttribute(mark);
    for (const el of textHidden) el.removeAttribute(textMark);
    for (const el of pictures) el.removeAttribute(picture);
  }
  // The choices of a list (sizes, lengths, colors) are part of what a page offers. They are written out as text in
  // the copy: which one is chosen is known only in the live page, and the article reader drops form controls.
  const lists = [...document.querySelectorAll('select')];
  for (const [index, copy] of [...clone.querySelectorAll('select')].entries()) {
    const chosen = lists[index]?.selectedIndex ?? -1;
    const options = [...copy.options].slice(0, 30).map((option, at) => `${(option.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}${at === chosen ? ' (chosen)' : ''}`);
    const text = clone.createElement('span');
    text.textContent = options.length > 0 ? ` (choices: ${options.join(' | ')}) ` : '';
    copy.replaceWith(text);
  }
  for (const el of clone.querySelectorAll(`[${mark}]`)) {
    if (hiddenText.length < HIDDEN_SAMPLE) hiddenText += ` ${el.textContent ?? ''}`;
    el.remove();
  }
  for (const el of clone.querySelectorAll(`[${textMark}]`)) {
    for (const node of [...el.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? '';
      if (text.trim() && hiddenText.length < HIDDEN_SAMPLE) hiddenText += ` ${text}`;
      node.remove();
    }
  }
  hiddenText = hiddenText.replace(/\s+/g, ' ').trim().slice(0, HIDDEN_SAMPLE);
  // A product page says its price, stock and rating in its metadata; that goes in front of the text.
  const product = productFromJsonLd([...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => script.textContent ?? '').filter((source) => source.length < 200_000), location.href);
  // The picture a page names for sharing is the product's, where the product data has none.
  if (product && !product.image) product.image = pictureAddress(document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined, location.href);
  const lead = product ? `${describeProduct(product)}\n\n` : '';
  const extra = { ...(hiddenText ? { hiddenText } : {}), ...(product ? { product: true } : {}) };

  const bodyText = normalizeText(document.body?.innerText ?? '');
  const visibleBody = clone.body?.innerHTML ?? '';
  try {
    const article = new Readability(clone.cloneNode(true) as Document).parse();
    const articleText = article?.textContent?.trim() ?? '';
    if (article?.content && articleText.length >= Math.min(1000, bodyText.length * 0.5)) {
      return { ...base, ...extra, markdown: lead + toMarkdown(article.content, picture), method: 'readability' };
    }
  } catch {
    // Fall through to the whole body.
  }
  return { ...base, ...extra, markdown: lead + toMarkdown(visibleBody, picture), method: 'innerText' };
});

/** Writes the address of the page's larger pictures into an attribute of theirs. Returns them so the marks can be removed again. */
function markPictures(attribute: string, hidden: string): Element[] {
  const marked: Element[] = [];
  for (const img of document.images) {
    if (marked.length >= MAX_PICTURES) break;
    const rect = img.getBoundingClientRect();
    if (rect.width < PICTURE_SIDE || rect.height < PICTURE_SIDE || img.closest(`[${hidden}]`)) continue;
    const address = pictureAddress(img.currentSrc || img.src, location.href);
    if (!address) continue;
    img.setAttribute(attribute, address);
    marked.push(img);
  }
  return marked;
}

/** Marks elements whose text a person cannot see. Returns them so the marks can be removed again. */
function markHidden(mark: string, textMark: string): { hidden: Element[]; textHidden: Element[] } {
  const hidden: Element[] = [];
  const textHidden: Element[] = [];
  const pageWidth = Math.max(document.documentElement.scrollWidth, innerWidth);
  const pageHeight = Math.max(document.documentElement.scrollHeight, innerHeight);
  const hasDirectText = (el: Element) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
  const walk = (el: Element) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT' || el.tagName === 'TEMPLATE') return;
    if (isHidden(el, pageWidth, pageHeight)) {
      el.setAttribute(mark, '');
      hidden.push(el);
      return;
    }
    if (el instanceof HTMLElement && isTransparentColor(getComputedStyle(el).color) && hasDirectText(el)) {
      el.setAttribute(textMark, '');
      textHidden.push(el);
    }
    for (const child of el.children) walk(child);
  };
  if (document.body) walk(document.body);
  return { hidden, textHidden };
}

function isZeroClip(style: CSSStyleDeclaration): boolean {
  if (/^inset\(\s*(?:100%|50%\s+50%)/i.test(style.clipPath) || style.clipPath === 'circle(0px)' || style.clipPath === 'polygon(0px 0px)') return true;
  return /^rect\(\s*0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?[,\s]+0(?:px)?\s*\)$/i.test(style.clip);
}

function isHidden(el: Element, pageWidth: number, pageHeight: number): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
  if (isInvisibleOpacity(style.opacity)) return true;
  const hasText = Boolean(el.textContent?.trim());
  if (parseFloat(style.fontSize) < 4 && hasText) return true;
  if (isTransparentColor(style.color) && hasText && !el.querySelector('img, svg, video, canvas')) return true;
  if (isZeroClip(style) && hasText) return true;
  const clippedOverflow = style.overflow === 'hidden' || style.overflow === 'clip' || style.overflowX === 'hidden' || style.overflowY === 'hidden';
  if (Math.abs(parseFloat(style.textIndent)) >= 1000 && clippedOverflow && hasText) return true;
  const rect = el.getBoundingClientRect();
  // Clipped or transformed to zero/1px (visually hidden, regardless of position).
  if (hasText && (rect.width <= 1 || rect.height <= 1) && clippedOverflow) return true;
  if (hasText && rect.width === 0 && rect.height === 0 && style.display !== 'contents' && style.display !== 'inline') return true;
  const left = rect.left + scrollX;
  const top = rect.top + scrollY;
  if (style.position === 'absolute' || style.position === 'fixed') {
    // Pushed off the page, e.g. left: -9999px.
    if (left + rect.width <= 0 || top + rect.height <= 0 || left >= pageWidth || top >= pageHeight) return true;
  } else if (hasText && (left + rect.width <= -100 || top + rect.height <= -100)) {
    return true;
  }
  return false;
}

function toMarkdown(html: string, picture: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  turndown.remove(['script', 'style', 'noscript', 'template']);
  turndown.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = ((node as HTMLImageElement).alt ?? '').replace(/[\[\]\s]+/g, ' ').trim().slice(0, 120);
      const address = (node as HTMLImageElement).getAttribute(picture);
      if (address) return `![${alt}](${address})`;
      return alt ? `[image: ${alt}]` : '';
    },
  });
  return normalizeText(turndown.turndown(html));
}

function normalizeText(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
