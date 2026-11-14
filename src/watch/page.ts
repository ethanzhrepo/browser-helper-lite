import type { WatchPart } from './watch';

export type PageCommand =
  /** Find the pieces of the page that contain these texts. */
  | { kind: 'locate'; quotes: string[] }
  /** What those pieces say now (null where one is gone). */
  | { kind: 'probe'; locators: string[] }
  /** Keep comparing them as the page changes, and say so once when one differs. */
  | { kind: 'live'; id: string; parts: WatchPart[]; everySeconds: number }
  /** Whether the page asks to prove that a person is there (a CAPTCHA, a "checking your browser" page). */
  | { kind: 'blocked' }
  | { kind: 'stop' };

/**
 * Runs in the watched page (injected, so it must stand alone: nothing from
 * outside this function exists there). It only reads the page.
 *
 * - locate: for each quote, the smallest element whose text contains it, as
 *   a CSS path, with its text. When none is found, the whole page as a digest.
 * - probe: the text at those paths now.
 * - live: compares on every change of the page (and on a timer), and sends
 *   one message to the extension when a piece differs. Then it stops; the
 *   extension looks at the page and starts it again.
 */
export function watchInPage(command: PageCommand): WatchPart[] | (string | null)[] | boolean {
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const digest = (text: string) => {
    const value = clean(text);
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${value.length}:${(hash >>> 0).toString(16)}`;
  };
  const textAt = (locator: string): string | null => {
    if (!locator) return digest(document.body?.innerText ?? '');
    let element: Element | null = null;
    try {
      element = document.querySelector(locator);
    } catch {
      return null;
    }
    return element ? clean((element as HTMLElement).innerText ?? element.textContent).slice(0, 500) : null;
  };
  const pathOf = (element: Element): string => {
    const steps: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && node !== document.documentElement && depth < 16; depth++) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'body') {
        steps.unshift('body');
        break;
      }
      // An id that looks written by a person, and is the only one of its kind, is a firm anchor.
      const id = node.id;
      if (id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{4,}/.test(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
        steps.unshift(`#${CSS.escape(id)}`);
        break;
      }
      const same = Array.from(node.parentElement?.children ?? []).filter((child) => child.tagName === node!.tagName);
      steps.unshift(`${tag}:nth-of-type(${same.indexOf(node) + 1})`);
      node = node.parentElement;
    }
    return steps.join(' > ');
  };
  const find = (quote: string): Element | null => {
    const wanted = clean(quote).toLowerCase();
    if (!wanted || !document.body) return null;
    const holds = (element: Element) => clean(element.textContent).toLowerCase().includes(wanted);
    if (!holds(document.body)) return null;
    let best: Element = document.body;
    for (;;) {
      const inner: Element | undefined = Array.from(best.children).find((child) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(child.tagName) && holds(child));
      if (!inner) break;
      best = inner;
    }
    return best === document.body ? null : best;
  };

  const scope = window as unknown as { __browserHelperWatch?: { stop(): void } };

  switch (command.kind) {
    case 'locate': {
      const parts: WatchPart[] = [];
      for (const quote of command.quotes) {
        const element = find(quote);
        const locator = element ? pathOf(element) : '';
        const text = locator ? textAt(locator) : null;
        if (locator && text !== null && !parts.some((part) => part.locator === locator)) parts.push({ locator, text });
      }
      // Nothing of what the model named was found: watch the page's whole text.
      return parts.length > 0 ? parts : [{ locator: '', text: textAt('')! }];
    }
    case 'probe':
      return command.locators.map(textAt);
    case 'blocked': {
      const shown = (selector: string) =>
        [...document.querySelectorAll(selector)].some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      return (
        /\/sorry\//.test(location.pathname) ||
        /^(just a moment|attention required|access denied|are you a robot|verify you are human|robot check)/i.test(document.title) ||
        shown('.g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="captcha"]')
      );
    }
    case 'stop':
      scope.__browserHelperWatch?.stop();
      return true;
    case 'live': {
      scope.__browserHelperWatch?.stop();
      const { id, parts } = command;
      const every = Math.max(1, command.everySeconds) * 1000;
      let lastRun = 0;
      let later: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        observer.disconnect();
        clearInterval(timer);
        clearTimeout(later);
        delete scope.__browserHelperWatch;
      };
      const compare = () => {
        lastRun = Date.now();
        if (parts.every((part) => textAt(part.locator) === part.text)) return;
        stop();
        const runtime = (globalThis as unknown as { chrome?: { runtime?: { sendMessage(message: unknown): Promise<unknown> } } }).chrome?.runtime;
        void runtime?.sendMessage({ type: 'watch.changed', id })?.catch(() => undefined);
      };
      // The page changed. Reading it is not free, so not more than once a second.
      const observer = new MutationObserver(() => {
        const wait = 1000 - (Date.now() - lastRun);
        if (wait <= 0) return compare();
        clearTimeout(later);
        later = setTimeout(compare, wait);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      const timer = setInterval(compare, every);
      scope.__browserHelperWatch = { stop };
      return true;
    }
  }
}
