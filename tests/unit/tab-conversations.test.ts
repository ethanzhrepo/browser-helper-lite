import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { conversationForTab, linkTab, unlinkTab, watchTabConversation } from '../../src/storage/tab-conversations';

describe('tab conversations', () => {
  beforeEach(() => fakeBrowser.reset());

  it('links, finds and unlinks a tab', async () => {
    expect(await conversationForTab(7)).toBeUndefined();
    await linkTab(7, 'c1');
    await linkTab(8, 'c1');
    await linkTab(9, 'c2');
    expect(await conversationForTab(7)).toBe('c1');
    expect(await conversationForTab(8)).toBe('c1');
    await unlinkTab(7);
    expect(await conversationForTab(7)).toBeUndefined();
    expect(await conversationForTab(9)).toBe('c2');
  });

  it('keeps the links in session storage, out of the synced settings', async () => {
    await linkTab(3, 'c1');
    expect(await fakeBrowser.storage.local.get()).toEqual({});
    expect(await fakeBrowser.storage.session.get()).toEqual({ 'tabConversation:3': 'c1' });
  });

  it('ignores tabs without an id', async () => {
    await linkTab(-1, 'c1');
    expect(await fakeBrowser.storage.session.get()).toEqual({});
  });

  it('reports changes for one tab only', async () => {
    const listener = vi.fn();
    const stop = watchTabConversation(5, listener);
    await linkTab(6, 'other');
    await linkTab(5, 'mine');
    await unlinkTab(5);
    stop();
    await linkTab(5, 'after');
    expect(listener.mock.calls).toEqual([['mine'], [undefined]]);
  });
});
