import { describe, expect, it } from 'vitest';
import { isRestrictedUrl, originPattern } from '../../src/permissions/hosts';

describe('originPattern', () => {
  it('drops path and port', () => {
    expect(originPattern('https://www.rogers.com/plans?x=1')).toBe('https://www.rogers.com/*');
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
  });
});

describe('isRestrictedUrl', () => {
  it('flags pages Chrome does not let extensions read', () => {
    expect(isRestrictedUrl('chrome://settings')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isRestrictedUrl(undefined)).toBe(true);
    expect(isRestrictedUrl('https://www.amazon.ca/')).toBe(false);
  });
});
