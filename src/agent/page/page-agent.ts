import { browser } from 'wxt/browser';
import { parseKeyCombo } from '../keys';
import { isTransparentColor } from '../../browser/visibility';
import type {
  OverlayState,
  PageAgentApi,
  PageBlockers,
  PageResult,
  PageSnapshot,
  SearchEngine,
  SearchResult,
  TargetInfo,
  TargetPoint,
} from './types';

/**
 * In-page half of the agent (§7.2–7.4). Runs in the extension's isolated
 * world, so page scripts cannot see or call it. It keeps the element registry
 * between calls: indices from the latest snapshot stay valid until the next one.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'OBJECT', 'EMBED']);
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I', 'INS', 'KBD',
  'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch',
  'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem',
]);
const TEXT_LIMIT = 150;
const LABEL_LIMIT = 80;

const CAPTCHA_SELECTOR = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-sitekey]',
].join(',');

function clip(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/**
 * Page text must not look like our element markers: "[12]<button>…" written
 * in a page could make the model act on the wrong element.
 */
function escapeMarkers(text: string): string {
  return text.replace(/\[(\d+)\]/g, '($1)');
}

function attr(value: string): string {
  return escapeMarkers(clip(value, 60).replace(/"/g, "'"));
}

/** Text a person cannot read: transparent or tiny (a place to hide instructions for AI). */
function unreadableText(style: CSSStyleDeclaration): boolean {
  if (parseFloat(style.fontSize) < 4) return true;
  return isTransparentColor(style.color);
}

function isTopVisible(rect: DOMRect | { width: number; height: number }) {
  return rect.width > 1 && rect.height > 1;
}

/** Offset of a document's viewport inside the top-level viewport (same-origin frames). */
function frameOffset(doc: Document): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let frame = doc.defaultView?.frameElement ?? null;
  while (frame) {
    const rect = frame.getBoundingClientRect();
    x += rect.left + frame.clientLeft;
    y += rect.top + frame.clientTop;
    frame = frame.ownerDocument.defaultView?.frameElement ?? null;
  }
  return { x, y };
}

function topRect(el: Element) {
  const rect = el.getBoundingClientRect();
  const offset = el.ownerDocument === document ? { x: 0, y: 0 } : frameOffset(el.ownerDocument);
  return { left: rect.left + offset.x, top: rect.top + offset.y, width: rect.width, height: rect.height };
}

function inViewport(rect: { left: number; top: number; width: number; height: number }) {
  return rect.top + rect.height > 0 && rect.top < innerHeight && rect.left + rect.width > 0 && rect.left < innerWidth;
}

function elementText(el: Element): string {
  const text = clip((el as HTMLElement).innerText ?? el.textContent ?? '', LABEL_LIMIT);
  if (text) return escapeMarkers(text);
  const img = el.querySelector('img[alt]');
  const svgTitle = el.querySelector('svg title');
  return escapeMarkers(clip(img?.getAttribute('alt') || svgTitle?.textContent || '', LABEL_LIMIT));
}

/** Text of a form control's <label>, without the text of controls inside it. */
function labelText(el: Element): string {
  const labels = (el as HTMLInputElement).labels;
  if (!labels || labels.length === 0) return '';
  let text = '';
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
      else if (child instanceof Element && !(child instanceof HTMLSelectElement || child instanceof HTMLInputElement || child instanceof HTMLTextAreaElement)) walk(child);
    }
  };
  walk(labels[0]!);
  return clip(text, LABEL_LIMIT);
}

/**
 * Text of the button that submits a form (what pressing Enter in one of its
 * fields does), so the risk check sees "Place order" rather than "Coupon".
 */
function submitterText(form: HTMLFormElement | null): string | undefined {
  if (!form) return undefined;
  const own = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]');
  const outside = form.id ? document.querySelector(`[form="${CSS.escape(form.id)}"][type="submit"]`) : null;
  const button = own ?? outside;
  if (!button) return undefined;
  const parts = [elementText(button), button.getAttribute('aria-label'), (button as HTMLInputElement).value, button.getAttribute('alt')];
  return clip(parts.filter(Boolean).join(' '), LABEL_LIMIT) || undefined;
}

function shortHref(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === 'javascript:') return '';
    const path = `${url.pathname}${url.search}`;
    return url.origin === location.origin ? path : `${url.host}${path}`;
  } catch {
    return '';
  }
}

function isEditable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

const SEARCH_HINT = /search|query|^q$|搜索|搜寻|查找|recherch|buscar|busca/i;

function isSearchField(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.type === 'search') return true;
  const role = el.getAttribute('role');
  if (role === 'searchbox' || el.closest('[role="search"], search')) return true;
  const hints = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')];
  return hints.some((hint) => hint && SEARCH_HINT.test(hint));
}

function cursorIsPointer(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.cursor !== 'pointer') return false;
  const parent = el.parentElement;
  // `cursor` is inherited, so only the element that sets it counts.
  return !parent || getComputedStyle(parent).cursor !== 'pointer';
}

function isInteractive(el: Element, style: CSSStyleDeclaration): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'hidden';
  if (tag === 'A') return el.hasAttribute('href') || cursorIsPointer(el, style);
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return true;
  if (el.hasAttribute('onclick')) return true;
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex !== null && Number(tabIndex) >= 0 && tag !== 'BODY' && tag !== 'HTML') return true;
  return cursorIsPointer(el, style);
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value) attrs.push(`${name}="${attr(value)}"`);
  };
  add('role', el.getAttribute('role'));
  const text = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? '' : elementText(el);

  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    add('label', labelText(el));
  }
  if (el instanceof HTMLInputElement) {
    add('type', el.type);
    add('name', el.name);
    add('placeholder', el.placeholder);
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) attrs.push('checked');
    } else if (el.type === 'password') {
      if (el.value) add('value', '••••');
    } else {
      add('value', el.value);
    }
  } else if (el instanceof HTMLTextAreaElement) {
    add('placeholder', el.placeholder);
    add('value', el.value);
  } else if (el instanceof HTMLSelectElement) {
    add('selected', el.selectedOptions[0]?.text);
    const options = [...el.options].map((o) => o.text.trim()).filter(Boolean);
    add('options', options.slice(0, 12).join(' | ') + (options.length > 12 ? ' | …' : ''));
  } else if (el instanceof HTMLButtonElement && el.type === 'submit' && el.form) {
    add('type', 'submit');
  }
  if (el instanceof HTMLAnchorElement) add('href', shortHref(el.href));
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && clip(ariaLabel, LABEL_LIMIT) !== text) add('aria-label', ariaLabel);
  for (const state of ['aria-checked', 'aria-selected', 'aria-expanded', 'aria-pressed']) add(state, el.getAttribute(state));
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') attrs.push('disabled');
  if (!text && !ariaLabel) add('title', el.getAttribute('title'));

  const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  return tag === 'input' ? `<${tag}${attrText}>` : `<${tag}${attrText}>${text}</${tag}>`;
}

function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const isControl = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const name =
    el.getAttribute('aria-label') ||
    (isControl ? labelText(el) || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name : '') ||
    (el instanceof HTMLSelectElement ? '' : elementText(el));
  return name ? `${tag} "${clip(name, 50)}"` : tag;
}

function deepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  for (;;) {
    if (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    else if (active instanceof HTMLIFrameElement) {
      try {
        const inner = active.contentDocument?.activeElement;
        if (!inner || inner === active.contentDocument?.body) break;
        active = inner;
      } catch {
        break;
      }
    } else break;
  }
  return active;
}

export function createPageAgent(): PageAgentApi {
  let registry = new Map<number, Element>();
  let previous = new WeakSet<Element>();
  let hasPrevious = false;
  let acting = false;
  let actingTimer: ReturnType<typeof setTimeout> | undefined;
  let overlayMode: OverlayState['mode'] = 'hidden';
  let lastInterference = 0;

  // ---- Overlay: glow border, status bar, virtual cursor, highlight boxes ----
  const host = document.createElement('browser-helper-overlay');
  // !important inline styles: page CSS cannot hide or move the overlay and its Stop button.
  const HOST_STYLE: [string, string][] = [
    ['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['pointer-events', 'none'], ['z-index', '2147483647'],
    ['display', 'block'], ['opacity', '1'], ['visibility', 'visible'], ['transform', 'none'], ['filter', 'none'], ['clip-path', 'none'],
  ];
  const styleHost = () => {
    for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, 'important');
  };
  styleHost();
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .frame { position: fixed; inset: 0; pointer-events: none; border-radius: 0;
        box-shadow: inset 0 0 0 2px rgba(31,107,87,.85), inset 0 0 36px rgba(31,107,87,.22);
        animation: breathe 2.4s ease-in-out infinite; }
      .frame.waiting { box-shadow: inset 0 0 0 2px rgba(234,152,40,.95), inset 0 0 36px rgba(234,152,40,.28); }
      @keyframes breathe { 50% { opacity: .55; } }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center;
        max-width: calc(100vw - 32px); padding: 5px 5px 5px 12px; border-radius: 999px;
        background: rgba(22,22,28,.86); color: #f4f4f6; border: 1px solid rgba(255,255,255,.1);
        -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);
        font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.2); pointer-events: auto;
        animation: drop .3s cubic-bezier(.2,.7,.3,1); }
      @keyframes drop { from { opacity: 0; transform: translate(-50%, -8px); } }
      .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #3a9a7c;
        box-shadow: 0 0 0 3px rgba(58,154,124,.28); animation: blink 1.4s ease-in-out infinite; }
      .waiting-bar .dot { background: #f0a43a; box-shadow: 0 0 0 3px rgba(240,164,58,.25); }
      @keyframes blink { 50% { opacity: .4; } }
      .bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 2px; }
      .bar button { all: unset; cursor: pointer; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.1);
        color: #fff; font-weight: 600; white-space: nowrap; transition: background .15s; }
      .bar button:hover { background: rgba(255,255,255,.18); }
      .bar button.primary { background: #1f6b57; }
      .bar button.primary:hover { filter: brightness(1.1); }
      .cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; pointer-events: none; display: none;
        transition: transform .35s cubic-bezier(.2,.7,.3,1); filter: drop-shadow(0 2px 4px rgba(0,0,0,.3)); }
      .ripple { position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
        border: 2px solid #1f6b57; background: rgba(31,107,87,.14); pointer-events: none; animation: ripple .55s ease-out forwards; }
      @keyframes ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
      .box { position: fixed; border: 1.5px solid #1f6b57; border-radius: 4px; background: rgba(31,107,87,.06); pointer-events: none; }
      .box b { position: absolute; top: -1px; left: -1px; transform: translateY(-100%); background: #1f6b57; color: #fff;
        font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; padding: 2px 5px; border-radius: 4px 4px 4px 0; }
      [hidden] { display: none !important; }
    </style>
    <div class="frame" hidden></div>
    <div class="bar" hidden><i class="dot"></i><span></span><button class="primary" data-action="continue" hidden></button><button data-action="stop"></button></div>
    <svg class="cursor" viewBox="0 0 24 24"><defs><linearGradient id="bh-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a7d66"/><stop offset="1" stop-color="#185747"/></linearGradient></defs><path d="M4 2l15 11-6.5 1 4 7.5-3 1.5-4-7.5L4 20z" fill="url(#bh-g)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div class="boxes"></div>`;
  const frame = root.querySelector<HTMLDivElement>('.frame')!;
  const bar = root.querySelector<HTMLDivElement>('.bar')!;
  const barText = bar.querySelector('span')!;
  const stopButton = bar.querySelector<HTMLButtonElement>('[data-action="stop"]')!;
  const continueButton = bar.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
  const cursor = root.querySelector<SVGElement>('.cursor')!;
  const boxes = root.querySelector<HTMLDivElement>('.boxes')!;

  const notify = (action: 'stop' | 'continue' | 'interference') => {
    void browser.runtime.sendMessage({ type: 'agent.overlay', action }).catch(() => undefined);
  };
  stopButton.addEventListener('click', () => notify('stop'));
  continueButton.addEventListener('click', () => notify('continue'));

  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  // Put the overlay back if the page removes it or changes its style while the agent works.
  new MutationObserver(() => {
    if (overlayMode === 'hidden') return;
    mount();
    if (HOST_STYLE.some(([name, value]) => host.style.getPropertyValue(name) !== value || host.style.getPropertyPriority(name) !== 'important')) styleHost();
  }).observe(document.documentElement, { childList: true, subtree: false });
  new MutationObserver(() => {
    if (HOST_STYLE.some(([name, value]) => host.style.getPropertyValue(name) !== value)) styleHost();
  }).observe(host, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });

  // Real (trusted) input from the user while the agent runs pauses the task (§4.3).
  const onUserInput = (event: Event) => {
    if (!event.isTrusted || acting || overlayMode !== 'running') return;
    if (event.composedPath().includes(host)) return;
    const now = Date.now();
    if (now - lastInterference < 1000) return;
    lastInterference = now;
    notify('interference');
  };
  window.addEventListener('mousedown', onUserInput, true);
  window.addEventListener('keydown', onUserInput, true);

  const get = (index: number): Element | undefined => {
    const el = registry.get(index);
    return el?.isConnected ? el : undefined;
  };
  const missing = (index: number): PageResult<never> => ({
    ok: false,
    error: `Element [${index}] is not on the page anymore. Use an index from the latest state.`,
  });

  const ensureInView = (el: Element) => {
    if (!inViewport(topRect(el))) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  };

  // ---- Snapshot ----
  const snapshot = ({ maxChars }: { maxChars: number }): PageSnapshot => {
    const next = new Map<number, Element>();
    const seen = new WeakSet<Element>();
    const folded = new WeakSet<Element>();
    const lines: string[] = [];
    let chars = 0;
    let truncated = false;
    let above = 0;
    let below = 0;
    let lastLine = '';

    const emit = (line: string) => {
      if (truncated || line === lastLine) return;
      if (chars + line.length > maxChars) {
        truncated = true;
        return;
      }
      lines.push(line);
      chars += line.length + 1;
      lastLine = line;
    };

    const inlineText = (el: Element): string => {
      let out = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
        else if (node instanceof Element && INLINE_TAGS.has(node.tagName) && node.tagName !== 'A') {
          const style = getComputedStyle(node);
          // Hidden or unreadable inline text (a common place to hide instructions for AI) is left out.
          const invisible = style.visibility === 'hidden' || style.opacity === '0' || unreadableText(style);
          if (style.display === 'none' || invisible || isInteractive(node, style)) {
            if (invisible) folded.add(node);
            out += ' ';
            continue;
          }
          folded.add(node);
          out += inlineText(node);
        } else out += ' ';
      }
      return out;
    };

    const visitChildren = (el: Element, inInteractive: boolean, hidden: boolean) => {
      if (el.shadowRoot) {
        for (const child of el.shadowRoot.children) visit(child, inInteractive, hidden);
        return;
      }
      if (el instanceof HTMLSlotElement) {
        const assigned = el.assignedElements({ flatten: true });
        for (const child of assigned.length > 0 ? assigned : [...el.children]) visit(child, inInteractive, hidden);
        return;
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const inner = el.contentDocument?.documentElement;
          if (inner) visit(inner, inInteractive, hidden);
        } catch {
          // Cross-origin frames are not readable from here.
        }
        return;
      }
      for (const child of el.children) visit(child, inInteractive, hidden);
    };

    /** `hidden`: an ancestor has opacity 0 (e.g. a closed dropdown menu). */
    const visit = (el: Element, inInteractive: boolean, hidden: boolean) => {
      if (SKIP_TAGS.has(el.tagName) || el === host || seen.has(el) || folded.has(el)) return;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === 'none') return;
      const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
      const rect = topRect(el);
      const transparent = hidden || style.opacity === '0';
      const visible = !transparent && isTopVisible(rect) && style.visibility !== 'hidden';

      const interactive = visible && (!inInteractive || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && isInteractive(el, style);
      if (interactive) {
        if (inViewport(rect)) {
          if (!truncated) {
            const index = next.size + 1;
            next.set(index, el);
            emit(`${hasPrevious && !previous.has(el) ? '*' : ''}[${index}]${describe(el)}`);
          }
        } else if (rect.top >= innerHeight) below++;
        else above++;
        if (!isSvg) visitChildren(el, true, transparent);
        return;
      }
      if (isSvg) return;
      if (!inInteractive && visible && inViewport(rect) && !unreadableText(style)) {
        const text = escapeMarkers(clip(inlineText(el), TEXT_LIMIT));
        if (text.length > 1) emit(text);
      }
      visitChildren(el, inInteractive, transparent);
    };

    visit(document.documentElement, false, false);
    previous = new WeakSet(next.values());
    hasPrevious = true;
    registry = next;

    const scroller = document.scrollingElement ?? document.documentElement;
    return {
      url: location.href,
      title: document.title,
      content: lines.join('\n'),
      elementCount: next.size,
      above,
      below,
      pixelsAbove: Math.round(scroller.scrollTop),
      pixelsBelow: Math.max(0, Math.round(scroller.scrollHeight - scroller.scrollTop - innerHeight)),
      truncated,
      blockers: detectBlockers(),
    };
  };

  const detectBlockers = (): PageBlockers => {
    const visible = (selector: string) =>
      [...document.querySelectorAll(selector)].some((el) => isTopVisible(el.getBoundingClientRect()));
    const captchaPage =
      /\/sorry\//.test(location.pathname) ||
      /^(just a moment|attention required)/i.test(document.title);
    return {
      captcha: captchaPage || visible(CAPTCHA_SELECTOR),
      passwordField: visible('input[type="password"]'),
      oneTimeCodeField: visible('input[autocomplete="one-time-code"]'),
    };
  };

  const targetInfo = (el: Element): TargetInfo => {
    const input = el instanceof HTMLInputElement ? el : undefined;
    const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase();
    const form = (el as HTMLInputElement).form ?? el.closest('form');
    return {
      tag: el.tagName.toLowerCase(),
      type: input?.type ?? (el instanceof HTMLButtonElement ? el.type : undefined),
      role: el.getAttribute('role') ?? undefined,
      text: elementText(el) || (input?.value ?? ''),
      ariaLabel: el.getAttribute('aria-label') ?? undefined,
      // Only real destinations; "#" and javascript: links are buttons in disguise.
      href: el instanceof HTMLAnchorElement && /^(?!#|javascript:)./i.test(el.getAttribute('href') ?? '') ? el.href : undefined,
      inForm: Boolean(form),
      isSubmit:
        (el instanceof HTMLButtonElement && el.type === 'submit' && Boolean(el.form)) ||
        (input?.type === 'submit' && Boolean(input.form)),
      isPassword: input?.type === 'password',
      isPaymentField: autocomplete.startsWith('cc-') || /card.?number|cvv|cvc/i.test(`${input?.name ?? ''} ${input?.id ?? ''}`),
      isOneTimeCode: autocomplete === 'one-time-code',
      isSelect: el instanceof HTMLSelectElement,
      isSearchField: isSearchField(el),
      editable: isEditable(el),
      disabled: Boolean((el as HTMLButtonElement).disabled) || el.getAttribute('aria-disabled') === 'true',
      formSubmitText: submitterText(form),
      label: shortLabel(el),
    };
  };

  const describeTarget = (index: number): PageResult<TargetInfo> => {
    const el = get(index);
    return el ? { ok: true, value: targetInfo(el) } : missing(index);
  };

  /** What a key press would act on: the focused element, if any. */
  const describeFocused = (): PageResult<TargetInfo | null> => {
    const el = deepActiveElement();
    return { ok: true, value: el && el !== document.body && el !== document.documentElement ? targetInfo(el) : null };
  };

  const locate = (index: number): PageResult<TargetPoint> => {
    const el = get(index);
    if (!el) return missing(index);
    ensureInView(el);
    const rect = topRect(el);
    const x = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    let occludedBy: string | undefined;
    if (el.ownerDocument === document) {
      const hit = document.elementFromPoint(x, y);
      const label = el instanceof HTMLInputElement ? [...(el.labels ?? [])] : [];
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !label.some((l) => l.contains(hit))) {
        occludedBy = describe(hit).slice(0, 120);
      }
    }
    return { ok: true, value: { x, y, occludedBy } };
  };

  const pointerEvents = (el: Element, types: string[]) => {
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    };
    for (const type of types) {
      const event = type.startsWith('pointer')
        ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true })
        : new MouseEvent(type, init);
      el.dispatchEvent(event);
    }
  };

  const domPress = (keys: string): PageResult<true> => {
    const { key, code, ctrlKey, altKey, shiftKey, metaKey } = parseKeyCombo(keys);
    const target = deepActiveElement() ?? document.body;
    const init = { key, code, ctrlKey, altKey, shiftKey, metaKey, bubbles: true, cancelable: true, composed: true };
    const accepted = target.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key.length === 1 || key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    // Synthetic Enter does not submit forms, so do what the browser would.
    if (accepted && key === 'Enter' && target instanceof HTMLInputElement && target.form) {
      target.form.requestSubmit();
    }
    return { ok: true, value: true };
  };

  const selectText = (index: number): PageResult<true> => {
    const el = get(index);
    if (!el) return missing(index);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.select();
    } else if ((el as HTMLElement).isContentEditable) {
      (el as HTMLElement).focus();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const selection = el.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return { ok: true, value: true };
  };

  const scrollableIn = (el: Element | null): Element | null => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return null;
  };

  return {
    snapshot,
    describeTarget,
    describeFocused,
    locate,
    detectBlockers,

    focus(index) {
      const el = get(index);
      if (!el) return missing(index);
      ensureInView(el);
      (el as HTMLElement).focus?.();
      // Put the caret at the end so typed text is appended.
      if ((el instanceof HTMLInputElement && isEditable(el)) || el instanceof HTMLTextAreaElement) {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
      return { ok: true, value: true };
    },

    selectText,

    domClick(index) {
      const el = get(index);
      if (!el) return missing(index);
      ensureInView(el);
      pointerEvents(el, ['pointerover', 'mouseover', 'pointerdown', 'mousedown']);
      (el as HTMLElement).focus?.();
      pointerEvents(el, ['pointerup', 'mouseup']);
      (el as HTMLElement).click();
      return { ok: true, value: true };
    },

    domHover(index) {
      const el = get(index);
      if (!el) return missing(index);
      ensureInView(el);
      pointerEvents(el, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']);
      return { ok: true, value: true };
    },

    domType({ index, text, clear }) {
      const el = get(index);
      if (!el) return missing(index);
      ensureInView(el);
      (el as HTMLElement).focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // The isolated world's native setter bypasses frameworks' value trackers,
        // so React and friends see the input event as a real change.
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const value = clear ? text : el.value + text;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if ((el as HTMLElement).isContentEditable) {
        if (clear) selectText(index);
        el.ownerDocument.execCommand('insertText', false, text);
      } else {
        return { ok: false, error: `Element [${index}] is not a text field.` };
      }
      return { ok: true, value: true };
    },

    domPress,

    selectOption({ index, option }) {
      const el = get(index);
      if (!el) return missing(index);
      if (!(el instanceof HTMLSelectElement)) {
        return { ok: false, error: `Element [${index}] is not a native <select>. Click it to open the list instead.` };
      }
      const wanted = option.trim().toLowerCase();
      const options = [...el.options];
      const match =
        options.find((o) => o.text.trim().toLowerCase() === wanted) ??
        options.find((o) => o.value.toLowerCase() === wanted) ??
        options.find((o) => o.text.toLowerCase().includes(wanted));
      if (!match) {
        return { ok: false, error: `No option matching "${option}". Options: ${options.map((o) => o.text.trim()).join(' | ')}` };
      }
      el.value = match.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: match.text.trim() };
    },

    scroll({ direction, amount, index }) {
      const sign = direction === 'down' ? 1 : -1;
      let target: Element | null = index !== undefined ? (get(index) ?? null) : null;
      if (index !== undefined && !target) return missing(index);
      const page = document.scrollingElement ?? document.documentElement;
      if (target) target = scrollableIn(target);
      else if (page.scrollHeight <= innerHeight + 4) {
        // Pages that scroll an inner container instead of the window.
        target = scrollableIn(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
      }
      const scroller = target ?? page;
      const before = scroller.scrollTop;
      const distance = sign * amount * (target ? target.clientHeight : innerHeight) * 0.85;
      scroller.scrollBy({ top: distance, behavior: 'instant' });
      return { ok: true, value: { moved: Math.abs(scroller.scrollTop - before) > 1 } };
    },

    setOverlay(state) {
      overlayMode = state.mode;
      if (state.mode === 'hidden') {
        host.remove();
        return true;
      }
      mount();
      frame.hidden = false;
      frame.classList.toggle('waiting', state.mode === 'waiting');
      bar.classList.toggle('waiting-bar', state.mode === 'waiting');
      bar.hidden = false;
      barText.textContent = state.message;
      stopButton.textContent = state.stopLabel;
      continueButton.hidden = !state.continueLabel;
      continueButton.textContent = state.continueLabel ?? '';
      if (state.mode !== 'running') cursor.style.display = 'none';
      return true;
    },

    moveCursor({ x, y, click }) {
      mount();
      cursor.style.display = 'block';
      cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
      if (click) {
        setTimeout(() => {
          const ripple = document.createElement('div');
          ripple.className = 'ripple';
          ripple.style.left = `${x}px`;
          ripple.style.top = `${y}px`;
          root.appendChild(ripple);
          setTimeout(() => ripple.remove(), 600);
        }, 350);
      }
      return true;
    },

    highlight(show) {
      boxes.replaceChildren();
      // Keep our own border, bar and cursor out of screenshots.
      for (const el of [frame, bar, cursor]) el.style.visibility = show ? 'hidden' : '';
      if (!show) return true;
      mount();
      for (const [index, el] of registry) {
        if (!el.isConnected) continue;
        const rect = topRect(el);
        if (!inViewport(rect)) continue;
        const box = document.createElement('div');
        box.className = 'box';
        box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
        const label = document.createElement('b');
        label.textContent = String(index);
        box.appendChild(label);
        boxes.appendChild(box);
      }
      return true;
    },

    setActing(value) {
      clearTimeout(actingTimer);
      if (value) acting = true;
      // Keep ignoring input briefly: trusted CDP events can arrive late.
      else actingTimer = setTimeout(() => (acting = false), 400);
      return true;
    },

    readSearchResults(engine: SearchEngine): SearchResult[] {
      const results: SearchResult[] = [];
      const push = (anchor: HTMLAnchorElement | null, title: string, snippet: string) => {
        if (!anchor?.href || !title.trim()) return;
        let url = anchor.href;
        try {
          const parsed = new URL(url);
          // Google sometimes wraps results in /url?q=…
          if (parsed.pathname === '/url' && parsed.searchParams.get('q')) url = parsed.searchParams.get('q')!;
        } catch {
          return;
        }
        if (results.some((r) => r.url === url)) return;
        results.push({ title: clip(title, 120), url, snippet: clip(snippet, 240) });
      };
      if (engine === 'google') {
        for (const h3 of document.querySelectorAll('a h3')) {
          const anchor = h3.closest('a');
          const block = h3.closest('[data-hveid], .g, .MjjYud') ?? anchor?.parentElement;
          const snippet = (block as HTMLElement | null)?.innerText.replace((h3 as HTMLElement).innerText, '') ?? '';
          push(anchor, (h3 as HTMLElement).innerText, snippet);
        }
      } else if (engine === 'bing') {
        for (const item of document.querySelectorAll('li.b_algo')) {
          const anchor = item.querySelector<HTMLAnchorElement>('h2 a');
          push(anchor, anchor?.innerText ?? '', item.querySelector<HTMLElement>('.b_caption p')?.innerText ?? '');
        }
      } else if (engine === 'duckduckgo') {
        for (const item of document.querySelectorAll('.result')) {
          const anchor = item.querySelector<HTMLAnchorElement>('a.result__a');
          push(anchor, anchor?.innerText ?? '', item.querySelector<HTMLElement>('.result__snippet')?.innerText ?? '');
        }
      }
      if (results.length === 0) {
        // Generic fallback: headings inside links, then prominent links.
        for (const heading of document.querySelectorAll('a h2, a h3')) {
          const anchor = heading.closest('a');
          push(anchor, (heading as HTMLElement).innerText, anchor?.parentElement?.innerText ?? '');
        }
      }
      return results.slice(0, 8);
    },
  };
}
