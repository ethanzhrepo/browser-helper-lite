/**
 * True for a fully transparent CSS color, as getComputedStyle reports it:
 * "transparent", "rgba(r, g, b, 0)" or "rgb(r g b / 0%)". Only a fourth
 * component is an alpha; "rgb(0, 0, 0)" is black.
 */
export function isTransparentColor(color: string): boolean {
  if (color.trim() === 'transparent') return true;
  const body = /^rgba?\(([^)]*)\)$/.exec(color.trim())?.[1];
  if (!body) return false;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 4) return false;
  const alpha = parts[3]!;
  return parseFloat(alpha) === 0;
}
