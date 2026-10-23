/**
 * Contract between the service worker and the in-page agent script
 * (entrypoints/agent-page.ts). Everything here must be structured-cloneable.
 */

export interface PageBlockers {
  captcha: boolean;
  passwordField: boolean;
  oneTimeCodeField: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Viewport content: `[n]<tag …>text</tag>` for interactive elements, plain lines for text. */
  content: string;
  elementCount: number;
  /** Interactive elements outside the viewport. */
  above: number;
  below: number;
  pixelsAbove: number;
  pixelsBelow: number;
  truncated: boolean;
  blockers: PageBlockers;
}

/** What the risk classifier needs to know about a target element. */
export interface TargetInfo {
  tag: string;
  type?: string;
  role?: string;
  text: string;
  ariaLabel?: string;
  href?: string;
  inForm: boolean;
  isSubmit: boolean;
  isPassword: boolean;
  isPaymentField: boolean;
  isOneTimeCode: boolean;
  isSelect: boolean;
  /** Search boxes: pressing Enter there only runs a search. */
  isSearchField: boolean;
  editable: boolean;
  disabled: boolean;
  /** For an element inside a form: the text of the button that submits it. */
  formSubmitText?: string;
  /** Short human label, e.g. `button "Add to cart"`. */
  label: string;
}

export interface TargetPoint {
  x: number;
  y: number;
  /** Description of the element covering the target, if any. */
  occludedBy?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchEngine = 'google' | 'bing' | 'duckduckgo' | 'custom';

export interface OverlayState {
  mode: 'running' | 'waiting' | 'hidden';
  message: string;
  stopLabel: string;
  continueLabel?: string;
}

export type PageResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageAgentApi {
  snapshot(params: { maxChars: number }): PageSnapshot;
  describeTarget(index: number): PageResult<TargetInfo>;
  /** The focused element, which a key press acts on. */
  describeFocused(): PageResult<TargetInfo | null>;
  /** Scrolls the element into view and returns its center in top-frame viewport pixels. */
  locate(index: number): PageResult<TargetPoint>;
  focus(index: number): PageResult<true>;
  selectText(index: number): PageResult<true>;
  domClick(index: number): PageResult<true>;
  domHover(index: number): PageResult<true>;
  domType(params: { index: number; text: string; clear: boolean }): PageResult<true>;
  domPress(keys: string): PageResult<true>;
  selectOption(params: { index: number; option: string }): PageResult<string>;
  scroll(params: { direction: 'up' | 'down'; amount: number; index?: number }): PageResult<{ moved: boolean }>;
  detectBlockers(): PageBlockers;
  setOverlay(state: OverlayState): true;
  moveCursor(point: { x: number; y: number; click: boolean }): true;
  /** Draws numbered boxes over visible interactive elements (for screenshots). */
  highlight(show: boolean): true;
  /** Marks the window during which input comes from the agent, not the user. */
  setActing(acting: boolean): true;
  readSearchResults(engine: SearchEngine): SearchResult[];
}
