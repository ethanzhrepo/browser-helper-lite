import { tool } from 'ai';
import { z } from 'zod';

const index = z.number().int().min(1).describe('Element number from the latest page state, e.g. 12 for [12]');
const url = z.string().describe('Absolute URL, e.g. https://www.example.com/page');

/**
 * The agent's action space (§7.3). Tools have no `execute`: the runtime runs
 * them itself so it can check risk, ask for approval, and observe the page.
 */
export const agentTools = {
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
  extract: tool({
    description:
      'Read the whole current page (not just the viewport) and extract information for a query. Use this to collect prices, plans, specs, steps or lists. The result is kept in your history.',
    inputSchema: z.object({ query: z.string().describe('What to extract, e.g. "all plan names, monthly prices and data"') }),
  }),
  look: tool({
    description:
      'Look at a screenshot of the viewport (elements are outlined with their numbers) and answer a question. Use it for icons, images, colors, calendars, charts or anything the text list does not show.',
    inputSchema: z.object({ question: z.string() }),
  }),
  web_search: tool({
    description:
      'Search the web in a background tab and return the top results (title, URL, snippet). Use it when the current site lacks the information, then verify on the official site when possible.',
    inputSchema: z.object({ query: z.string() }),
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
  done: tool({
    description: 'Finish the task. Call this alone, as the only action of the step.',
    inputSchema: z.object({
      success: z.boolean().describe('Whether the task was completed'),
      summary: z
        .string()
        .describe('The final answer for the user in Markdown: results, comparison tables, source links, and anything left for them to do'),
    }),
  }),
};

export type AgentToolName = keyof typeof agentTools;

/** Tools that act on an element of the current page. */
export const ELEMENT_TOOLS = new Set<string>(['click', 'type', 'hover', 'select_option']);
