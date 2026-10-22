import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { PageExtraction } from '../src/browser/page-context';

/**
 * Injected on demand with scripting.executeScript to turn the current page
 * into Markdown. Article-like pages go through Readability; app-like pages
 * (dashboards, consoles) fall back to the visible text.
 */
export default defineUnlistedScript((): PageExtraction => {
  const bodyText = normalizeText(document.body?.innerText ?? '');
  const base = { title: document.title, url: location.href, lang: document.documentElement.lang };

  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    const articleText = article?.textContent?.trim() ?? '';
    if (article?.content && articleText.length >= Math.min(1000, bodyText.length * 0.5)) {
      return { ...base, markdown: toMarkdown(article.content), method: 'readability' };
    }
  } catch {
    // Fall through to the plain-text extraction.
  }
  return { ...base, markdown: bodyText, method: 'innerText' };
});

function toMarkdown(html: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  turndown.remove(['script', 'style', 'noscript']);
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
