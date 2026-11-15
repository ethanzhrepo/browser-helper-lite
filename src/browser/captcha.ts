/**
 * Whether the page is asking a person to prove they are one, right now.
 *
 * Runs in the page, also injected on its own (watch-service.ts), so it must
 * stand alone: nothing from outside this function exists there.
 *
 * Most pages that load a CAPTCHA never show one: reCAPTCHA v3 and the
 * invisible kinds score the visit in the background and only put a badge in
 * a corner. Those are not a reason to stop. What counts:
 * - a page that is nothing but the check ("Just a moment…", Google's /sorry/);
 * - a box to tick or a puzzle that is on screen and not yet solved.
 * A widget the user has solved stays on the page with a tick; its answer
 * field is filled in then, and it no longer counts.
 */
export function challengeShown(): boolean {
  if (/\/sorry\//.test(location.pathname)) return true;
  if (/^(just a moment|attention required|are you a robot|verify (that )?you are (a )?human|robot check|security check)/i.test(document.title.trim())) return true;

  /** On screen: it has a size, is not hidden or see-through, and at least part of it is inside the window. */
  const shown = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  /** The widget's answer, filled in once the person has passed. */
  const solved = (element: Element, field: string): boolean => {
    // The field sits next to the widget: in its form, or in the box around a frame.
    const scope = element.closest('form') ?? (element instanceof HTMLIFrameElement ? element.parentElement?.parentElement : element) ?? document;
    const answers = [...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`)];
    return answers.length > 0 && answers.every((answer) => answer.value.trim().length > 0);
  };
  /** The corner badge, and widgets set up to stay out of sight: they ask nothing of the person. */
  const silent = (element: Element): boolean =>
    element.closest('.grecaptcha-badge') !== null || element.closest('[data-size="invisible"]') !== null;

  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[src], iframe[title]')) {
    const src = frame.getAttribute('src') ?? '';
    const title = frame.getAttribute('title') ?? '';
    let field = '';
    if (/recaptcha/i.test(src)) {
      // "anchor" is the box (or the badge, when invisible); "bframe" is the picture puzzle, on screen only while it is asked.
      if (/[?&]size=invisible/.test(src)) continue;
      field = /\/bframe/.test(src) ? '' : 'g-recaptcha-response';
    } else if (/hcaptcha\.com/i.test(src)) {
      if (/[#&]size=invisible/.test(src)) continue;
      field = /frame=challenge/.test(src) ? '' : 'h-captcha-response';
    } else if (/challenges\.cloudflare\.com/i.test(src)) {
      field = 'cf-turnstile-response';
    } else if (/arkoselabs\.com|funcaptcha\.com|geetest\.com|captcha-delivery\.com/i.test(src) || /\bcaptcha\b/i.test(title)) {
      field = '';
    } else {
      continue;
    }
    if (silent(frame) || !shown(frame)) continue;
    if (field && solved(frame, field)) continue;
    return true;
  }

  // A check the page draws itself (Cloudflare's own form, a widget not yet in a frame).
  for (const element of document.querySelectorAll('#challenge-form, #challenge-stage, .g-recaptcha, .h-captcha, .cf-turnstile')) {
    // With a frame inside, the frame was judged above; a button the check is tied to asks nothing by itself.
    if (element.querySelector('iframe') || element.matches('button, input, a')) continue;
    if (silent(element) || !shown(element)) continue;
    const field = element.matches('.g-recaptcha') ? 'g-recaptcha-response' : element.matches('.h-captcha') ? 'h-captcha-response' : element.matches('.cf-turnstile') ? 'cf-turnstile-response' : '';
    if (field && solved(element, field)) continue;
    return true;
  }
  return false;
}
