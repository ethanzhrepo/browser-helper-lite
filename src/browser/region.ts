import { browser } from 'wxt/browser';
import type { RegionCaptureRequest, RegionCaptureResult } from '../shared/protocol';
import type { MessageImage } from '../shared/types';

/** A rectangle of the viewport, in CSS pixels, with the page's device pixels per CSS pixel. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
}

/** Longest edge of the image sent to a model. */
const MAX_EDGE = 1280;
const MIN_SIDE = 8;

/**
 * Runs in the page: darkens it and lets the user drag a rectangle. Resolves
 * with the rectangle, or null when Escape is pressed. It lives in a closed
 * shadow root, so the page's styles and scripts do not reach it, and it is
 * gone before it resolves, so it never shows in the screenshot.
 */
function pickRegionInPage(hint: string): Promise<Region | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;cursor:crosshair;background:rgba(15,23,42,.28);touch-action:none;';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;display:none;border:2px solid #fff;outline:1px solid rgba(15,23,42,.6);box-shadow:0 0 0 100vmax rgba(15,23,42,.45);pointer-events:none;';
    const label = document.createElement('div');
    label.textContent = hint;
    label.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:rgba(15,23,42,.85);color:#fff;font:500 13px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap;';
    root.append(veil, box, label);

    let start: { x: number; y: number } | undefined;
    const rect = (event: PointerEvent) => {
      const x = Math.max(0, Math.min(start!.x, event.clientX));
      const y = Math.max(0, Math.min(start!.y, event.clientY));
      return {
        x,
        y,
        width: Math.min(innerWidth, Math.max(start!.x, event.clientX)) - x,
        height: Math.min(innerHeight, Math.max(start!.y, event.clientY)) - y,
      };
    };
    const finish = (region: Region | null) => {
      window.removeEventListener('keydown', onKey, true);
      host.remove();
      // Two frames, so the page is painted without the overlay before the screenshot.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(region)));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    veil.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      veil.setPointerCapture(event.pointerId);
      veil.style.background = 'transparent';
      label.style.display = 'none';
    });
    veil.addEventListener('pointermove', (event) => {
      if (!start) return;
      const r = rect(event);
      box.style.cssText += `display:block;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;`;
    });
    veil.addEventListener('pointerup', (event) => {
      if (!start) return;
      const r = rect(event);
      // A click without a drag is not a choice: try again.
      if (r.width < 8 || r.height < 8) {
        start = undefined;
        box.style.display = 'none';
        veil.style.background = 'rgba(15,23,42,.28)';
        label.style.display = '';
        return;
      }
      finish({ ...r, pixelRatio: devicePixelRatio || 1 });
    });
    window.addEventListener('keydown', onKey, true);
    document.documentElement.append(host);
  });
}

/** Lets the user drag a rectangle on the tab's page. Undefined when they pressed Escape. Throws when the page takes no scripts. */
export async function pickRegion(tabId: number, hint: string): Promise<Region | undefined> {
  const [result] = await browser.scripting.executeScript({ target: { tabId }, func: pickRegionInPage, args: [hint] });
  return (result?.result as Region | null | undefined) ?? undefined;
}

/** The size of the cut-out image: the region in CSS pixels, scaled down to fit MAX_EDGE. */
export function regionSize(region: Pick<Region, 'width' | 'height'>): { width: number; height: number } {
  const shrink = Math.min(1, MAX_EDGE / Math.max(region.width, region.height, 1));
  return { width: Math.max(1, Math.round(region.width * shrink)), height: Math.max(1, Math.round(region.height * shrink)) };
}

/** Screenshots the tab (in the background, which may need the debugger for it) and cuts the region out. */
export async function captureRegion(tab: { id: number; url: string; title: string }, region: Region): Promise<MessageImage | undefined> {
  if (region.width < MIN_SIDE || region.height < MIN_SIDE) return undefined;
  const request: RegionCaptureRequest = { type: 'region.capture', tabId: tab.id };
  const shot = (await browser.runtime.sendMessage(request)) as RegionCaptureResult | undefined;
  if (!shot?.ok || !shot.image) return undefined;
  const binary = atob(shot.image);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: shot.mediaType }));
  // A dense display captures two or three pixels per CSS pixel. The capture need not cover the whole viewport, so its width says nothing.
  const scale = region.pixelRatio > 0 ? region.pixelRatio : 1;
  const size = regionSize(region);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')!.drawImage(bitmap, region.x * scale, region.y * scale, region.width * scale, region.height * scale, 0, 0, size.width, size.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg', ...size, url: tab.url, title: tab.title };
}
