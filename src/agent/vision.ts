import type { PageVisuals } from './page/types';

/** Why the text view of a page is not enough, so a screenshot goes with it. */
export type ScreenshotReason = 'drawn' | 'frames' | 'icons' | 'pictures' | 'errors';

const SPARSE_TEXT_CHARS = 300;

/**
 * Decides whether a page view needs a screenshot: when much of the viewport
 * is drawn (canvas, video), sits in another site's frame, or is made of
 * controls without names; when pictures stand in for text; or when steps
 * keep failing. A page that is merely short does not need one.
 */
export function screenshotReason(visual: PageVisuals, view: { elements: number; textChars: number }, consecutiveErrors: number): ScreenshotReason | undefined {
  if (visual.drawn >= 0.2) return 'drawn';
  if (visual.frames >= 0.2) return 'frames';
  if (visual.unlabeled >= 3 && visual.unlabeled >= view.elements * 0.3) return 'icons';
  if (visual.pictures >= 0.4 && view.textChars < SPARSE_TEXT_CHARS) return 'pictures';
  if (consecutiveErrors >= 2) return 'errors';
  return undefined;
}

export const SCREENSHOT_WHY: Record<ScreenshotReason, string> = {
  drawn: 'much of this page is drawn (a canvas or video), which the text view cannot show',
  frames: "much of this page sits in another site's frame, which the text view cannot read",
  icons: 'several controls on this page have no text',
  pictures: 'this page shows pictures where the text view has little',
  errors: 'the last steps failed',
};
