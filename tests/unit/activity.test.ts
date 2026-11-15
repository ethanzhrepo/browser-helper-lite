import { describe, expect, it } from 'vitest';
import { activityLabel, elapsedLabel } from '../../src/agent/activity';
import type { AgentAction, AgentStep, AgentTask } from '../../src/agent/types';
import en from '../../src/locales/en.json';
import zhCN from '../../src/locales/zh-CN.json';

const reader = (locale: unknown) =>
  ((key: string, options: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], locale);
    if (typeof value !== 'string') return typeof options.defaultValue === 'string' ? options.defaultValue : key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''));
  }) as unknown as Parameters<typeof activityLabel>[0];
const t = reader(en);

const action = (tool: string, args: Record<string, unknown> = {}, status: AgentAction['status'] = 'running', target?: string): AgentAction => ({ id: tool, tool, args, risk: 0, status, target });
const step = (actions: AgentAction[], url = 'https://www.shop.example/item'): AgentStep => ({ index: 1, url, actions });
const task = (steps: AgentStep[], draft = ''): AgentTask => ({ steps, draft }) as AgentTask;

describe('what a run says it is doing', () => {
  it('names what is under way: the search, the site, the skill', () => {
    expect(activityLabel(t, task([step([action('web_search', { query: 'robot vacuum test' })])]))).toBe('Searching: robot vacuum test');
    expect(activityLabel(t, task([step([action('research_pages', {}, 'running', '2/5')])]))).toBe('Reading pages 2/5');
    expect(activityLabel(t, task([step([action('navigate', { url: 'https://www.jd.com/item/1' })])]))).toBe('Opening jd.com');
    expect(activityLabel(t, task([step([action('open_tab', { url: 'https://forum.example/t/9' })])]))).toBe('Opening forum.example');
    expect(activityLabel(t, task([step([action('read_page')])]))).toBe('Reading shop.example');
    expect(activityLabel(t, task([step([action('read_url', { url: 'https://tests.example/vacuums' })])]))).toBe('Reading tests.example');
    expect(activityLabel(t, task([step([action('view_page')], '')]))).toBe('Reading the page');
    expect(activityLabel(t, task([step([action('look', { question: 'what is on the chart' })])]))).toBe('Looking at the screen');
    expect(activityLabel(t, task([step([action('read_skill_file', { skill: 'buying-guide', path: 'references/sources/cn.md' })])]))).toBe("Reading the skill's notes");
    expect(activityLabel(t, task([step([action('report_progress', { content: '…' })])]))).toBe('Writing up this stage');
    expect(activityLabel(t, task([step([action('ask_user', { question: 'Which size?' })])]))).toBe('Asking you');
    // A built-in skill by its title in the user's language; an installed one by its name.
    expect(activityLabel(t, task([step([action('load_skill', { name: 'buying-guide' })])]))).toBe('Using a skill: Buying guide');
    expect(activityLabel(reader(zhCN), task([step([action('load_skill', { name: 'compare-prices' })])]))).toBe('使用技能：比价');
    expect(activityLabel(t, task([step([action('load_skill', { name: 'forum-check' })])]))).toBe('Using a skill: forum-check');
  });

  it('clicks, typing, scrolling and waits are all work on the site', () => {
    for (const tool of ['click', 'type', 'scroll', 'wait', 'press', 'select_option']) {
      expect(activityLabel(t, task([step([action(tool)])])), tool).toBe('Working on shop.example');
    }
    expect(activityLabel(t, task([step([action('click')], 'chrome://newtab/')]))).toBe('Working on newtab');
    expect(activityLabel(t, task([step([action('click')], '')]))).toBe('Working on the page');
    // An action the user is asked about is still what the run is at.
    expect(activityLabel(t, task([step([action('click', {}, 'awaiting')])]))).toBe('Working on shop.example');
  });

  it('between steps it says that the model is thinking or writing, not what was done last', () => {
    expect(activityLabel(t, task([]))).toBe('Thinking…');
    expect(activityLabel(t, task([], 'The cheapest is'))).toBe('Writing…');
    // The search is over: the model is deciding what comes next.
    expect(activityLabel(t, task([step([action('web_search', { query: 'x' }, 'done')])]))).toBe('Thinking about the next step…');
    expect(activityLabel(t, task([step([action('web_search', { query: 'x' }, 'error')])]))).toBe('Thinking about the next step…');
    expect(activityLabel(t, task([step([action('web_search', { query: 'x' }, 'done')])], 'Both stores have it.'))).toBe('Writing…');
    // Of several calls in a step, the one that is running.
    expect(activityLabel(t, task([step([action('web_search', { query: 'a' }, 'done'), action('read_url', { url: 'https://b.example/' })])]))).toBe('Reading b.example');
    // Only the latest step counts.
    expect(activityLabel(t, task([step([action('web_search', { query: 'old' })]), step([action('read_page', {}, 'done')])]))).toBe('Thinking about the next step…');
  });

  it('counts the time in minutes and seconds', () => {
    expect(elapsedLabel(1000, 1000)).toBe('0:00');
    expect(elapsedLabel(0, 7_900)).toBe('0:07');
    expect(elapsedLabel(0, 760_000)).toBe('12:40');
    expect(elapsedLabel(5000, 0)).toBe('0:00');
  });
});
