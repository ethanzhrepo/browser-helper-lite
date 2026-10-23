import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { PageExtraction } from '../src/browser/page-context';
import { isTransparentColor } from '../src/browser/visibility';

const HIDDEN_SAMPLE = 4000;

/**
 * Injected on demand with scripting.executeScript to turn the current page
 * into Markdown. Article-like pages go through Readability; app-like pages
 * (dashboards, consoles) fall back to the whole body.
 *
 * Text a person cannot see (display: none, invisible, transparent, tiny or
 * off-screen) is left out: it is a common place to hide instructions for AI
 * assistants (§8.2). A sample of it is returned so it can be checked.
 */
export default defineUnlistedScript((): PageExtraction => {
  const base = { title: document.title, url: location.href, lang: document.documentElement.lang };
  // A new attribute name each run: a page cannot pre-mark visible content to hide it from the model.
  const mark = `data-bh-${Math.random().toString(36).slice(2, 10)}`;
  const marked = markHidden(mark);
  let hiddenText = '';
  let clone: Document;
  try {
    clone = document.cloneNode(true) as Document;
  } finally {
    for (const el of marked) el.removeAttribute(mark);
  }
  for (const el of clone.querySelectorAll(`[${mark}]`)) {
    if (hiddenText.length < HIDDEN_SAMPLE) hiddenText += ` ${el.textContent ?? ''}`;
    el.remove();
  }
  hiddenText = hiddenText.replace(/\s+/g, ' ').trim().slice(0, HIDDEN_SAMPLE);
  const extra = hiddenText ? { hiddenText } : {};

  const bodyText = normalizeText(document.body?.innerText ?? '');
  const visibleBody = clone.body?.innerHTML ?? '';
  try {
    const article = new Readability(clone.cloneNode(true) as Document).parse();
    const articleText = article?.textContent?.trim() ?? '';
    if (article?.content && articleText.length >= Math.min(1000, bodyText.length * 0.5)) {
      return { ...base, ...extra, markdown: toMarkdown(article.content), method: 'readability' };
    }
  } catch {
    // Fall through to the whole body.
  }
  return { ...base, ...extra, markdown: toMarkdown(visibleBody), method: 'innerText' };
});

/** Marks elements whose text a person cannot see. Returns them so the marks can be removed again. */
function markHidden(mark: string): Element[] {
  const marked: Element[] = [];
  const pageWidth = Math.max(document.documentElement.scrollWidth, innerWidth);
  const pageHeight = Math.max(document.documentElement.scrollHeight, innerHeight);
  const walk = (el: Element) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT' || el.tagName === 'TEMPLATE') return;
    if (isHidden(el, pageWidth, pageHeight)) {
      el.setAttribute(mark, '');
      marked.push(el);
      return;
    }
    for (const child of el.children) walk(child);
  };
  if (document.body) walk(document.body);
  return marked;
}

function isHidden(el: Element, pageWidth: number, pageHeight: number): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
  if (Number(style.opacity) === 0) return true;
  if (parseFloat(style.fontSize) < 4 && el.textContent?.trim()) return true;
  if (isTransparentColor(style.color) && el.textContent?.trim() && !el.querySelector('img, svg, video, canvas')) return true;
  if (style.position === 'absolute' || style.position === 'fixed') {
    const rect = el.getBoundingClientRect();
    const left = rect.left + scrollX;
    const top = rect.top + scrollY;
    // Pushed off the page, e.g. left: -9999px.
    if (left + rect.width <= 0 || top + rect.height <= 0 || left >= pageWidth || top >= pageHeight) return true;
    // Clipped to nothing (visually hidden).
    if (rect.width <= 1 && rect.height <= 1 && style.overflow === 'hidden') return true;
  }
  return false;
}

function toMarkdown(html: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  turndown.remove(['script', 'style', 'noscript', 'template']);
  turndown.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node as HTMLImageElement).alt?.trim();
      return alt ? `[image: ${alt}]` : '';
    },
  });
  return normalizeText(turndown.turndown(html));
}

function normalizeText(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
