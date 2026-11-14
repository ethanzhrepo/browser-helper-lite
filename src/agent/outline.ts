import type { SavedCommand } from '../shared/types';
import { containsCardNumber, containsSecret } from './injection';
import type { AgentAction, AgentTask } from './types';

const MAX_STEPS = 40;
const MAX_LINE = 160;
const NAME_CHARS = 24;

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const quote = (value: unknown, limit = 60) => `"${clip(String(value ?? '').replace(/\s+/g, ' ').trim(), limit)}"`;

/** One line for a step worth repeating; undefined for looking, waiting and asking, which a new run decides for itself. */
function line(action: AgentAction): string | undefined {
  const a = action.args;
  const target = action.target ?? '';
  switch (action.tool) {
    case 'navigate':
    case 'open_tab':
    case 'read_url':
      return `${action.tool} ${String(a.url ?? '')}`;
    case 'web_search':
      return `web_search ${quote(a.query)}`;
    case 'research_pages':
      return `research_pages ${quote(a.question)}`;
    case 'extract':
      return `extract ${quote(a.query)}`;
    case 'click':
    case 'hover':
      return target ? `${action.tool} ${target}` : undefined;
    case 'click_at':
      return `click_at ${target || 'a point of the page'}`;
    case 'type': {
      const text = String(a.text ?? '');
      // What was typed may be private: keys and card numbers are never kept.
      const shown = containsSecret(text) || containsCardNumber(text) ? 'the value' : quote(text, 80);
      return `type ${shown} into ${target || 'the field'}${a.submit === true ? ' and press Enter' : ''}`;
    }
    case 'select_option':
      return `select ${quote(a.option)} in ${target || 'the list'}`;
    case 'press':
      return `press ${String(a.keys ?? '')}${target ? ` in ${target}` : ''}`;
    default:
      return undefined;
  }
}

/** The steps of a finished task that got something done, as short lines a later run can take as a hint. */
export function outlineOf(task: Pick<AgentTask, 'steps'>): string[] {
  return task.steps
    .flatMap((step) => step.actions)
    .filter((action) => action.status === 'done')
    .map(line)
    .filter((text): text is string => Boolean(text))
    .map((text) => clip(text, MAX_LINE))
    .slice(0, MAX_STEPS);
}

/** A name that can be typed after a slash: no spaces, no slashes, not too long. */
export function commandName(text: string): string {
  return Array.from(text.trim().replace(/^\/+/, '').replace(/[\s/]+/g, '-')).slice(0, NAME_CHARS).join('').replace(/^-+|-+$/g, '');
}

/** A finished task as a command to run again: the request as it was asked, and the steps that worked. */
export function commandFrom(task: Pick<AgentTask, 'steps'>, request: string, name: string, id: string, now: number): SavedCommand {
  const startUrl = task.steps.find((step) => step.url && /^https?:/.test(step.url))?.url;
  return { id, name: commandName(name), prompt: request.trim(), steps: outlineOf(task), ...(startUrl ? { startUrl } : {}), createdAt: now };
}
