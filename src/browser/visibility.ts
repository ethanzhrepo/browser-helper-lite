/**
 * True for a transparent or near-invisible CSS color, as getComputedStyle
 * reports it: "transparent", "rgba(r, g, b, 0)", "rgba(r, g, b, 0.01)",
 * "rgb(r g b / 0%)" or "hsla(..., 0.01)". Only a fourth component is an alpha;
 * "rgb(0, 0, 0)" is black.
 */
export function isTransparentColor(color: string): boolean {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'transparent') return true;
  const body = /^(?:rgba?|hsla?)\(([^)]*)\)$/.exec(trimmed)?.[1];
  if (!body) return false;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 4) return false;
  const raw = parts[3]!;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return false;
  const alpha = raw.endsWith('%') ? value / 100 : value;
  return alpha < 0.02;
}

/** True for an opacity so low a person cannot read the text (e.g. 0 or 0.01). */
export function isInvisibleOpacity(opacity: string): boolean {
  const value = parseFloat(opacity);
  return Number.isFinite(value) && value < 0.02;
}
