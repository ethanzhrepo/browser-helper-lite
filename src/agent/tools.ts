import { tool } from 'ai';
import { z } from 'zod';

const index = z.number().int().min(1).describe('Element number in the latest view, e.g. 12 for [12]');
const url = z.string().describe('Absolute URL');

const SEARCH_DESCRIPTION =
  'Search the web and return the top results (title, URL, snippet). Use it when the current site lacks the information, then verify on the source when possible.';

/** What DeepSeek's search understands in a query, told to the model when that search is in use. */
const DEEPSEEK_SEARCH_SYNTAX =
  ' The query takes at most 128 characters and these operators: site:example.com (several joined with OR), -site:example.com, "exact phrase", -word, lang:en (or lang:zh,en), after:2025-01-01, before:2026. Add lang: when results should be in one language.';

const searchTool = (description: string) => tool({ description, inputSchema: z.object({ query: z.string() }) });

/**
 * The assistant's tools (§7.3, M1.5). They have no `execute`: the runtime runs
 * them itself so it can check risk, ask for approval, and observe the page.
 */
export const assistantTools = {
  read_page: tool({
    description:
      'Read the whole current tab as Markdown (not only the viewport). Use it to answer questions about the page, or to summarize or translate it.',
    inputSchema: z.object({}),
  }),
  view_page: tool({
    description:
      'See the visible part of the current tab with numbered interactive elements, to operate the page. Browser actions also return this view.',
    inputSchema: z.object({}),
  }),
  extract: tool({
    description:
      'Read the whole current tab and extract information for a query, e.g. prices, plans, specs, steps or lists. Cheaper than read_page on long pages.',
    inputSchema: z.object({ query: z.string().describe('What to extract, e.g. "all plan names, monthly prices and data"') }),
  }),
  look: tool({
    description:
      'Look at a screenshot of the viewport (elements are outlined with their numbers) and answer a question. Use it for icons, images, colors, calendars, charts, canvas content or anything the text does not show.',
    inputSchema: z.object({ question: z.string() }),
  }),
  web_search: searchTool(SEARCH_DESCRIPTION),
  watch_page: tool({
    description:
      'Keep an eye on a page for the user and notify them when a condition holds there (a price drops, tickets go on sale, a status changes). The page is read again on a timer, in the background, without touching it; the user confirms before it starts. Use it only when the user asks to be told later.',
    inputSchema: z.object({
      condition: z.string().describe('What must be true on the page, in the user\'s words and language, e.g. "The price of the 65W charger is under $20"'),
      url: url.optional().describe('The page to watch; the current tab when left out'),
      every_seconds: z.number().optional().describe('Seconds between checks when the user named a pace (e.g. 10, or 3600 for hourly); leave out otherwise. The user can change it when confirming.'),
    }),
  }),
  research_pages: tool({
    description:
      'Read two or more web pages in one call (up to 12) and get short notes from each about one question. Use it for search results and for addresses the user gave, instead of reading or opening pages one by one.',
    inputSchema: z.object({
      question: z.string().describe('What to find on each page, e.g. "price, battery life and weight of the laptop"'),
      urls: z.array(url).min(1).max(12).describe('Addresses from the search results'),
    }),
  }),
  navigate: tool({ description: 'Open a URL in the current tab.', inputSchema: z.object({ url }) }),
  click: tool({ description: 'Click an element.', inputSchema: z.object({ index }) }),
  click_at: tool({
    description:
      'Click a point of the latest screenshot, given in its pixels, for things that have no element number: canvas content, maps, embedded frames, icons without text. Whenever an element has a number, use click instead. Needs a screenshot of the page as it is now: look again after the page scrolled or changed.',
    inputSchema: z.object({
      x: z.number().min(0).describe('Pixels from the left edge of the screenshot'),
      y: z.number().min(0).describe('Pixels from the top edge of the screenshot'),
    }),
  }),
  type: tool({
    description: 'Type text into a text field. Replaces existing text unless clear is false.',
    inputSchema: z.object({
      index,
      text: z.string(),
      clear: z.boolean().optional().describe('Replace the current text (default true)'),
      submit: z.boolean().optional().describe('Press Enter afterwards, e.g. to run a search'),
    }),
  }),
  press: tool({
    description: 'Press a key or key combination on the focused element.',
    inputSchema: z.object({ keys: z.string().describe('e.g. "Enter", "Escape", "Tab", "Control+A"') }),
  }),
  hover: tool({ description: 'Move the mouse over an element, e.g. to open a menu.', inputSchema: z.object({ index }) }),
  scroll: tool({
    description: 'Scroll the page, or a scrollable element, to reveal more content.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down']),
      amount: z.number().min(0.25).max(10).optional().describe('Screens to scroll (default 1)'),
      index: index.optional().describe('Scroll inside this element instead of the page'),
    }),
  }),
  select_option: tool({
    description: 'Choose an option in a native <select> element.',
    inputSchema: z.object({ index, option: z.string().describe('Visible text or value of the option') }),
  }),
  go_back: tool({ description: 'Go back to the previous page in the current tab.', inputSchema: z.object({}) }),
  open_tab: tool({ description: 'Open a URL in a new tab and switch to it.', inputSchema: z.object({ url }) }),
  switch_tab: tool({
    description: 'Switch to another of your tabs.',
    inputSchema: z.object({ tab_id: z.number().int().describe('Tab id from the tab list') }),
  }),
  close_tab: tool({ description: 'Close one of your tabs.', inputSchema: z.object({ tab_id: z.number().int() }) }),
  wait: tool({
    description: 'Wait for the page to finish loading or updating.',
    inputSchema: z.object({ seconds: z.number().min(0.5).max(10) }),
  }),
  ask_user: tool({
    description: 'Ask the user a question and wait for the answer. Use it for choices, missing personal details or ambiguity.',
    inputSchema: z.object({ question: z.string() }),
  }),
  hand_off: tool({
    description:
      'Hand control to the user for something only they may do: logging in, solving a CAPTCHA, entering a verification code. Waits until they are done.',
    inputSchema: z.object({
      reason: z.enum(['login', 'captcha', 'verification', 'other']),
      message: z.string().describe('What the user should do, in their language'),
    }),
  }),
};

export type AssistantToolName = keyof typeof assistantTools;

/** Offered when there are skills to load (see skills.ts). */
const loadSkillTool = tool({
  description: 'Get the instructions of a skill listed under Skills. Call it before starting work that a skill is for, and follow what it returns.',
  inputSchema: z.object({ name: z.string().describe('The skill\'s name, as listed') }),
});

/** Offered when a skill comes with files besides its instructions. */
const readSkillFileTool = tool({
  description: 'Read a file that comes with a skill (a reference, a template, data), when the skill\'s instructions point to it. The file list is in what load_skill returned.',
  inputSchema: z.object({
    skill: z.string().describe('The skill\'s name'),
    path: z.string().describe('The file\'s path in the skill\'s folder, e.g. references/sizes.md'),
    offset: z.number().int().min(0).optional().describe('Where to go on reading a long file, as the previous read said'),
  }),
});

/** Offered only when pages can be read through DeepSeek's Fetch API. */
const readUrlTool = tool({
  description:
    'Read a public web page by its address without opening it, and get its text. Use it for search results, articles and documentation you only need to read. It does not see pages behind the user\'s login and cannot interact: open those in the tab instead. Forums and social media are not read this way either: open them in the tab.',
  inputSchema: z.object({ url }),
});

/** The tools for a task: the search tool described for the provider that will run it, and `read_url` when DeepSeek reads pages. */
export function toolsFor(search: { provider: string; deepseekFetch?: boolean }, { skills = false, skillFiles = false } = {}) {
  const deepseek = search.provider === 'deepseek';
  return {
    ...assistantTools,
    ...(deepseek ? { web_search: searchTool(SEARCH_DESCRIPTION + DEEPSEEK_SEARCH_SYNTAX) } : {}),
    ...(deepseek && search.deepseekFetch ? { read_url: readUrlTool } : {}),
    ...(skills ? { load_skill: loadSkillTool } : {}),
    ...(skills && skillFiles ? { read_skill_file: readSkillFileTool } : {}),
  };
}

/** Tools that act on an element of the current page. */
export const ELEMENT_TOOLS = new Set<string>(['click', 'type', 'hover', 'select_option']);

/** Tools that only read; they never take over the tab. */
export const READING_TOOLS = new Set<string>(['read_page', 'view_page', 'extract', 'look', 'web_search', 'read_url', 'research_pages', 'watch_page', 'load_skill', 'read_skill_file', 'ask_user']);

/** Tools after which the model gets a fresh page view. */
export const VIEW_AFTER = new Set<string>([
  'view_page', 'navigate', 'click', 'click_at', 'type', 'press', 'hover', 'scroll', 'select_option',
  'go_back', 'open_tab', 'switch_tab', 'close_tab', 'wait', 'hand_off',
]);
