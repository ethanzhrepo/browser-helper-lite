import { tool } from 'ai';
import { z } from 'zod';

const index = z.number().int().min(1).describe('Element number from the latest page view, e.g. 12 for [12]');
const url = z.string().describe('Absolute URL, e.g. https://www.example.com/page');

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
      'Look at a screenshot of the viewport (elements are outlined with their numbers) and answer a question. Use it for icons, images, colors, calendars, charts or anything the text does not show.',
    inputSchema: z.object({ question: z.string() }),
  }),
  web_search: tool({
    description:
      'Search the web and return the top results (title, URL, snippet). Use it when the current site lacks the information, then verify on the source when possible.',
    inputSchema: z.object({ query: z.string() }),
  }),
  navigate: tool({ description: 'Open a URL in the current tab.', inputSchema: z.object({ url }) }),
  click: tool({ description: 'Click an element.', inputSchema: z.object({ index }) }),
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

/** Tools that act on an element of the current page. */
export const ELEMENT_TOOLS = new Set<string>(['click', 'type', 'hover', 'select_option']);

/** Tools that only read; they never take over the tab. */
export const READING_TOOLS = new Set<string>(['read_page', 'view_page', 'extract', 'look', 'web_search', 'ask_user']);

/** Tools after which the model gets a fresh page view. */
export const VIEW_AFTER = new Set<string>([
  'view_page', 'navigate', 'click', 'type', 'press', 'hover', 'scroll', 'select_option',
  'go_back', 'open_tab', 'switch_tab', 'close_tab', 'wait', 'hand_off',
]);
