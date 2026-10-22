import { describe, expect, it } from 'vitest';
import { normalizeMath } from '../../src/ui/math';

describe('normalizeMath', () => {
  it('turns one-line $$…$$ and \\[…\\] into display math', () => {
    expect(normalizeMath('Sum:\n\n$$a + b$$\n')).toBe('Sum:\n\n$$\na + b\n$$\n');
    expect(normalizeMath('Sum: \\[ a + b \\] done')).toBe('Sum: \n$$\na + b\n$$\n done');
  });

  it('turns \\(…\\) into inline math', () => {
    expect(normalizeMath('where \\( x^2 \\) grows')).toBe('where $x^2$ grows');
  });

  it('leaves code alone', () => {
    const code = '```latex\n$$a$$\n\\[b\\]\n```';
    expect(normalizeMath(code)).toBe(code);
    expect(normalizeMath('use `\\(x\\)` here')).toBe('use `\\(x\\)` here');
  });

  it('treats a dollar sign before a digit as a price', () => {
    expect(normalizeMath('Plan A is $40/mo and Plan B $65/mo')).toBe('Plan A is \\$40/mo and Plan B \\$65/mo');
    expect(normalizeMath('| A | $9.99 |')).toBe('| A | \\$9.99 |');
    expect(normalizeMath('Energy $E = mc^2$')).toBe('Energy $E = mc^2$');
    expect(normalizeMath('\\( 2^n \\)')).toBe('$2^n$');
  });
});
