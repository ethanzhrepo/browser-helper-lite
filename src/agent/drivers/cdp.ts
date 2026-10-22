import { browser } from 'wxt/browser';
import { parseKeyCombo } from '../keys';

/**
 * CDP driver over chrome.debugger (§7.4): input events are trusted
 * (isTrusted = true), like a real user's. Chrome shows its "is debugging this
 * browser" bar while attached.
 */
export class CdpDriver {
  private attached = new Set<number>();
  private mouse = new Map<number, { x: number; y: number }>();

  constructor(private readonly onDetached: (tabId: number, reason: string) => void) {
    browser.debugger.onDetach.addListener(this.handleDetach);
  }

  private handleDetach = (source: { tabId?: number }, reason: string) => {
    if (source.tabId === undefined || !this.attached.has(source.tabId)) return;
    this.attached.delete(source.tabId);
    this.onDetached(source.tabId, reason);
  };

  async attach(tabId: number): Promise<void> {
    if (this.attached.has(tabId)) return;
    await browser.debugger.attach({ tabId }, '1.3');
    this.attached.add(tabId);
  }

  async detachAll(): Promise<void> {
    browser.debugger.onDetach.removeListener(this.handleDetach);
    await Promise.all(
      [...this.attached].map((tabId) => browser.debugger.detach({ tabId }).catch(() => undefined)),
    );
    this.attached.clear();
  }

  private async send(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
    await this.attach(tabId);
    return browser.debugger.sendCommand({ tabId }, method, params);
  }

  /** Moves along a short path so hover effects fire, like a real pointer. */
  async moveTo(tabId: number, x: number, y: number): Promise<void> {
    const from = this.mouse.get(tabId) ?? { x: x - 40, y: y - 40 };
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + (x - from.x) * t,
        y: from.y + (y - from.y) * t,
      });
    }
    this.mouse.set(tabId, { x, y });
  }

  async click(tabId: number, x: number, y: number): Promise<void> {
    await this.moveTo(tabId, x, y);
    const base = { x, y, button: 'left', clickCount: 1 };
    await this.send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 });
    await this.send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
  }

  async insertText(tabId: number, text: string): Promise<void> {
    await this.send(tabId, 'Input.insertText', { text });
  }

  async press(tabId: number, keys: string): Promise<void> {
    const combo = parseKeyCombo(keys);
    const modifiers = (combo.altKey ? 1 : 0) | (combo.ctrlKey ? 2 : 0) | (combo.metaKey ? 4 : 0) | (combo.shiftKey ? 8 : 0);
    const printable = combo.key.length === 1 && !combo.ctrlKey && !combo.metaKey && !combo.altKey;
    const text = combo.key === 'Enter' ? '\r' : printable ? combo.key : undefined;
    const base = {
      key: combo.key,
      code: combo.code,
      windowsVirtualKeyCode: combo.keyCode,
      nativeVirtualKeyCode: combo.keyCode,
      modifiers,
    };
    await this.send(tabId, 'Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text });
    await this.send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  /** JPEG screenshot of the viewport as base64. Works for background tabs too. */
  async screenshot(tabId: number): Promise<string> {
    const result = (await this.send(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 })) as { data: string };
    return result.data;
  }
}
