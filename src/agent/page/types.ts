/**
 * Contract between the service worker and the in-page agent script
 * (entrypoints/agent-page.ts). Everything here must be structured-cloneable.
 */

export interface PageBlockers {
  captcha: boolean;
  passwordField: boolean;
  oneTimeCodeField: boolean;
}

/** How much of the viewport the text view cannot show (fractions of its area), and how many controls have no name. */
export interface PageVisuals {
  /** Canvas, video and plugin content. */
  drawn: number;
  /** Frames from other sites. */
  frames: number;
  /** Images without alternative text, and large SVG drawings. */
  pictures: number;
  /** Numbered elements without any text or label (icon-only buttons). */
  unlabeled: number;
}

export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  /** Device pixels per CSS pixel (display density times zoom). */
  pixelRatio: number;
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
  visual: PageVisuals;
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
  /** For an element inside a form: how the form is sent ("get" or "post"). */
  formMethod?: 'get' | 'post';
  /** A link with the `download` attribute. */
  download?: boolean;
  /** A native select's options, for checking the one select_option picks. */
  options?: { text: string; value: string }[];
  /** Set when a click or key would land in a frame from another site, which the extension cannot read. */
  frameOrigin?: string;
  /** Drawn content (a canvas, a video): what is at the point cannot be read. Only set for a click by coordinates. */
  unreadable?: boolean;
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
  /** Name of the site, when the search provider gives one. */
  site?: string;
  /** Day the page was published (YYYY-MM-DD), when known. */
  date?: string;
}

export type SearchEngine = 'google' | 'bing' | 'duckduckgo' | 'custom';

export interface OverlayState {
  mode: 'running' | 'waiting' | 'hidden';
  message: string;
  stopLabel: string;
  continueLabel?: string;
  /** A button that opens the side panel, on a tab where it is not open (§4.7). */
  panelLabel?: string;
}

export type PageResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageAgentApi {
  snapshot(params: { maxChars: number }): PageSnapshot;
  describeTarget(index: number): PageResult<TargetInfo>;
  /** The focused element, which a key press acts on. */
  describeFocused(): PageResult<TargetInfo | null>;
  /** What a click at a point of the viewport (CSS pixels) would land on. */
  describePoint(point: { x: number; y: number }): PageResult<TargetInfo>;
  viewport(): Viewport;
  /** True when the page is the one on screen (its tab is in front and the window is not minimized). */
  shown(): boolean;
  /** Scrolls the element into view and returns its center in top-frame viewport pixels. */
  locate(index: number): PageResult<TargetPoint>;
  focus(index: number): PageResult<true>;
  selectText(index: number): PageResult<true>;
  domClick(index: number): PageResult<true>;
  domClickAt(point: { x: number; y: number }): PageResult<true>;
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
