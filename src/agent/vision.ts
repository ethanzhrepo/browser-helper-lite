import type { VisionStrategy } from '../shared/types';
import type { PageVisuals } from './page/types';

/** Why a page view includes a screenshot alongside the DOM text view. */
export type ScreenshotReason = 'drawn' | 'frames' | 'icons' | 'pictures' | 'errors' | 'noChange' | 'always';

const SPARSE_TEXT_CHARS = 300;
/** Many unnamed controls (e.g. color swatches or icon grids) warrant a screenshot even on large pages. */
const MANY_UNLABELED = 8;

export interface ScreenshotDecisionOptions {
  strategy?: VisionStrategy;
  /** True when the previous interactive action left the viewport text and elements unchanged. */
  noChange?: boolean;
  /** True when the current model reads images directly (without calling a separate vision model). */
  canReadDirectly?: boolean;
}

/**
 * Decides whether a page view needs a screenshot: when much of the viewport
 * is drawn (canvas, video), sits in another site's frame, or is made of
 * controls without names; when pictures stand in for text; when an action had
 * no visible text effect or steps keep failing; or always when the user opted
 * into DOM + compact SoM screenshots with a multimodal model.
 */
export function screenshotReason(
  visual: PageVisuals,
  view: { elements: number; textChars: number },
  consecutiveErrors: number,
  options: ScreenshotDecisionOptions = {},
): ScreenshotReason | undefined {
  const strategy = options.strategy ?? 'auto';
  if (strategy === 'off') return undefined;
  if (visual.drawn >= 0.2) return 'drawn';
  if (visual.frames >= 0.2) return 'frames';
  if ((visual.unlabeled >= 3 && visual.unlabeled >= view.elements * 0.3) || visual.unlabeled >= MANY_UNLABELED) return 'icons';
  if (visual.pictures >= 0.4 && view.textChars < SPARSE_TEXT_CHARS) return 'pictures';
  if (consecutiveErrors >= 2) return 'errors';
  if (options.noChange) return 'noChange';
  if (strategy === 'always' && options.canReadDirectly) return 'always';
  return undefined;
}

export const SCREENSHOT_WHY: Record<ScreenshotReason, string> = {
  drawn: 'much of this page is drawn (a canvas or video), which the text view cannot show',
  frames: "much of this page sits in another site's frame, which the text view cannot read",
  icons: 'several controls on this page have no text',
  pictures: 'this page shows pictures where the text view has little',
  errors: 'the last steps failed',
  noChange: 'the last action did not visibly change the text view',
  always: 'visual mode is set to include a numbered screenshot with each view',
};
