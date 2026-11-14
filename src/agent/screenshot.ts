/**
 * Screenshot handling in the service worker: scaling to the size the model is
 * told about, and cutting out the spot a click will land on.
 */

/** Longest edge sent to a model. Larger images are scaled down by the providers anyway, which would shift coordinates. */
export const MAX_SCREEN_EDGE = 1280;
const JPEG_QUALITY = 0.72;

async function decode(base64: string): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
}

async function encode(canvas: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The size of the image a capture becomes. One capture pixel is some number
 * of CSS pixels (a dense display captures two or three per CSS pixel); the
 * image is the capture in CSS pixels, scaled down to fit MAX_SCREEN_EDGE.
 *
 * The scale comes from the widths alone and applies to both axes, so the
 * image is never stretched: a capture may be shorter than the page's
 * `innerHeight` says (an emulated or partly hidden viewport), and stretching
 * it would move every coordinate.
 */
export function screenSize(capture: { width: number; height: number }, viewportWidth: number): { width: number; height: number; scale: number } {
  const cssPerPixel = viewportWidth / Math.max(capture.width, 1);
  const cssHeight = capture.height * cssPerPixel;
  const shrink = Math.min(1, MAX_SCREEN_EDGE / Math.max(viewportWidth, cssHeight, 1));
  const width = Math.max(1, Math.round(viewportWidth * shrink));
  return { width, height: Math.max(1, Math.round(cssHeight * shrink)), scale: viewportWidth / width };
}

/** Scales a capture to the image the model gets; `scale` is CSS pixels per image pixel, on both axes. */
export async function fitScreenshot(base64: string, viewport: { width: number }): Promise<{ image: string; width: number; height: number; scale: number }> {
  const bitmap = await decode(base64);
  const size = screenSize(bitmap, viewport.width);
  const canvas = new OffscreenCanvas(size.width, size.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return { image: await encode(canvas), ...size };
}

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;

/** The part of a screenshot around a point, with a ring on the point: what an approval card shows for a click by coordinates. */
export async function cropPreview(base64: string, x: number, y: number): Promise<string> {
  const bitmap = await decode(base64);
  const canvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const context = canvas.getContext('2d')!;
  const left = Math.min(Math.max(x - PREVIEW_WIDTH / 2, 0), Math.max(bitmap.width - PREVIEW_WIDTH, 0));
  const top = Math.min(Math.max(y - PREVIEW_HEIGHT / 2, 0), Math.max(bitmap.height - PREVIEW_HEIGHT, 0));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.drawImage(bitmap, -left, -top);
  bitmap.close();
  for (const [color, width] of [['#fff', 5], ['#d22f27', 2.5]] as const) {
    context.beginPath();
    context.arc(x - left, y - top, 13, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  }
  return `data:image/jpeg;base64,${await encode(canvas)}`;
}
