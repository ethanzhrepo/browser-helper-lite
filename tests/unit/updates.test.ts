import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { availableUpdate, checkForUpdate, checkForUpdateIfDue, dismissUpdate, isNewer, loadUpdateState } from '../../src/updates/check';

const release = (tag: string, url = `https://github.com/ethanzhrepo/browser-helper-lite/releases/tag/${tag}`) =>
  (async () => new Response(JSON.stringify({ tag_name: tag, html_url: url }))) as unknown as typeof fetch;

describe('update check', () => {
  beforeEach(() => fakeBrowser.reset());

  it('compares versions by number', () => {
    expect(isNewer('0.10.0', '0.9.1')).toBe(true);
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });

  it('offers a newer release with its page', async () => {
    const state = await checkForUpdate(release('v0.2.0'), 1000);
    expect(availableUpdate(state, '0.1.0')).toEqual({ version: '0.2.0', url: 'https://github.com/ethanzhrepo/browser-helper-lite/releases/tag/v0.2.0' });
    expect(availableUpdate(state, '0.2.0')).toBeUndefined();
  });

  it('links only to this project, whatever the answer says', async () => {
    const state = await checkForUpdate(release('v0.2.0', 'https://evil.example/download'), 1000);
    expect(availableUpdate(state, '0.1.0')!.url).toBe('https://github.com/ethanzhrepo/browser-helper-lite/releases/latest');
    const odd = await checkForUpdate(release('<img src=x>'), 2000);
    expect(odd.failed).toBe(true);
  });

  it('keeps the last answer when a check fails, and asks at most once a day', async () => {
    await checkForUpdate(release('v0.2.0'), 1000);
    const failing = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response('', { status: 403 });
    }) as unknown as typeof fetch;
    await checkForUpdateIfDue(counting, 1000 + 60_000);
    expect(calls).toBe(0);
    await checkForUpdateIfDue(counting, 1000 + 25 * 60 * 60 * 1000);
    expect(calls).toBe(1);
    const state = await checkForUpdate(failing, 5000);
    expect(state).toMatchObject({ failed: true, latest: '0.2.0' });
  });

  it('remembers a dismissed version', async () => {
    await checkForUpdate(release('v0.2.0'), 1000);
    await dismissUpdate('0.2.0');
    expect((await loadUpdateState())!.dismissed).toBe('0.2.0');
    // A later check keeps it.
    expect((await checkForUpdate(release('v0.2.0'), 2000)).dismissed).toBe('0.2.0');
  });
});
