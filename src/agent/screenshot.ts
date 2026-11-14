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

async function encode(canvas: OffscreenCanvas, quality = JPEG_QUALITY): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The size of the image a capture becomes. A capture has `pixelRatio` pixels
 * for each CSS pixel (two or three on a dense display, more when the page is
 * zoomed in); the image is the capture in CSS pixels, scaled down to fit
 * MAX_SCREEN_EDGE.
 *
 * The capture is not assumed to cover the viewport: it may be shorter or
 * narrower than the page says its viewport is (a window smaller than an
 * emulated viewport shows only its top left part). Its own size and the
 * pixel ratio say what it shows; stretching it to the viewport would move
 * every coordinate.
 */
export function screenSize(capture: { width: number; height: number }, pixelRatio: number): { width: number; height: number; scale: number } {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const cssWidth = capture.width / ratio;
  const cssHeight = capture.height / ratio;
  const shrink = Math.min(1, MAX_SCREEN_EDGE / Math.max(cssWidth, cssHeight, 1));
  const width = Math.max(1, Math.round(cssWidth * shrink));
  return { width, height: Math.max(1, Math.round(cssHeight * shrink)), scale: cssWidth / width };
}

/** Scales a capture to the image the model gets; `scale` is CSS pixels per image pixel, on both axes. */
export async function fitScreenshot(base64: string, pixelRatio: number): Promise<{ image: string; width: number; height: number; scale: number }> {
  const bitmap = await decode(base64);
  const size = screenSize(bitmap, pixelRatio);
  const canvas = new OffscreenCanvas(size.width, size.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return { image: await encode(canvas), ...size };
}

const THUMBNAIL_WIDTH = 640;

/**
 * A small copy of a capture, for the replay: enough to see where the
 * assistant was and what it clicked. `cssWidth` is how many CSS pixels of the
 * page its width shows, to place a click on it.
 */
export async function thumbnail(base64: string, pixelRatio: number): Promise<{ image: string; width: number; height: number; cssWidth: number }> {
  const bitmap = await decode(base64);
  const width = Math.min(THUMBNAIL_WIDTH, bitmap.width);
  const height = Math.max(1, Math.round((bitmap.height * width) / Math.max(bitmap.width, 1)));
  const cssWidth = bitmap.width / (pixelRatio > 0 ? pixelRatio : 1);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { image: await encode(canvas, 0.6), width, height, cssWidth };
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
