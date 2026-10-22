import type { AgentSettings, Locale } from '../shared/types';
import type { SearchResult } from './page/types';

const HL: Record<Locale, string> = { 'zh-CN': 'zh-CN', en: 'en', fr: 'fr', es: 'es' };

export function buildSearchUrl(agent: AgentSettings, query: string, locale: Locale): string {
  const q = encodeURIComponent(query);
  switch (agent.searchEngine) {
    case 'bing':
      return `https://www.bing.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://html.duckduckgo.com/html/?q=${q}`;
    case 'custom':
      if (agent.customSearchUrl.includes('%s')) return agent.customSearchUrl.replace('%s', q);
      return `https://www.google.com/search?q=${q}&hl=${HL[locale]}`;
    default:
      return `https://www.google.com/search?q=${q}&hl=${HL[locale]}`;
  }
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results found for "${query}".`;
  return [
    `Search results for "${query}" (verify on the source before relying on them):`,
    ...results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`),
  ].join('\n');
}
