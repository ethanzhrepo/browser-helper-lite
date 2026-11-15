import type { TFunction } from 'i18next';
import { BUILTIN_SKILLS } from '../skills/builtin';
import { skillTitle } from '../skills/titles';
import type { AgentTask } from './types';

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const hostOf = (url: unknown): string => {
  try {
    return new URL(String(url ?? '')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const OPENING = new Set(['navigate', 'open_tab']);
const READING = new Set(['read_page', 'extract', 'view_page', 'read_url']);
/** Still under way: the tool is running, or the user is asked about it. */
const UNDER_WAY = new Set(['running', 'awaiting']);

/**
 * What the run is doing right now, in words a person cares about: what it
 * searches for, which site it reads, which skill it uses, or that it is
 * deciding what to do next. It changes with every step, so a run never looks
 * as if it were only waiting. Clicking, typing, scrolling and waiting for a
 * page are all "working on the site"; the steps themselves are under the
 * details.
 */
export function activityLabel(t: TFunction, task: AgentTask): string {
  const step = task.steps.at(-1);
  const action = step?.actions.find((a) => UNDER_WAY.has(a.status));
  if (!action) {
    // Between steps the model is at work: writing (its words are streamed), or deciding what comes next.
    if (task.draft.trim()) return t('agent.activity.writing');
    return step ? t('agent.activity.next') : t('agent.thinking');
  }
  const args = action.args;
  switch (action.tool) {
    case 'web_search':
      return t('agent.activity.search', { query: clip(String(args.query ?? ''), 50) });
    case 'research_pages':
      return t('agent.activity.research', { progress: action.target ?? '' }).trim();
    case 'load_skill': {
      const name = String(args.name ?? '').replace(/^\/+/, '');
      const builtin = BUILTIN_SKILLS.find((skill) => skill.name === name);
      return t('agent.activity.skill', { name: builtin ? skillTitle(t, builtin).label : name });
    }
    case 'read_skill_file':
      return t('agent.activity.skillFile');
    case 'report_progress':
      return t('agent.activity.report');
    case 'look':
      return t('agent.activity.look');
    case 'watch_page':
      return t('agent.activity.watch');
    case 'ask_user':
      return t('agent.activity.ask');
    case 'hand_off':
      return t('agent.activity.handOff');
  }
  if (OPENING.has(action.tool)) {
    const site = hostOf(args.url);
    if (site) return t('agent.activity.open', { site });
  }
  const site = hostOf(action.tool === 'read_url' ? args.url : step?.url);
  if (READING.has(action.tool)) return site ? t('agent.activity.readSite', { site }) : t('agent.activity.read');
  return site ? t('agent.activity.act', { site }) : t('agent.activity.actHere');
}

/** How long a run has taken so far, as 0:07 or 12:40. */
export function elapsedLabel(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
