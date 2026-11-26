/**
 * Hardening helpers for Mermaid SVG output (§8.2).
 *
 * Mermaid's built-in `secure` list does not lock `htmlLabels`, `flowchart`,
 * `dompurifyConfig`, or `themeCSS`, and Mermaid's final SVG sanitize pass runs
 * without user `dompurifyConfig`. We lock all dangerous directive keys AND
 * sanitize the rendered SVG before inserting it into the DOM.
 */

export const MERMAID_SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'htmlLabels',
  'flowchart',
  'class',
  'state',
  'sequence',
  'dompurifyConfig',
  'themeCSS',
  'fontFamily',
];

export const MERMAID_FORBID_TAGS = ['img', 'image', 'foreignObject', 'a', 'style', 'script', 'iframe', 'object', 'embed'];

const FORBIDDEN_SVG_TAGS = new Set([
  'foreignobject',
  'img',
  'image',
  'script',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'feimage',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'handler',
  'listener',
]);

const FORBIDDEN_ATTRS = new Set(['src', 'srcdoc', 'srcset', 'action', 'formaction', 'ping', 'poster', 'background']);
const URL_BEARING_ATTRS = new Set(['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end']);
const LOCAL_FRAGMENT = /^#[A-Za-z0-9_.:-]+$/;

function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\\([^\n\r\f0-9a-fA-F])/g, '$1');
}

/** Strips @import, external url(...), image-set(...), and legacy scriptable CSS constructs. */
export function sanitizeSvgCss(css: string): string {
  const plain = decodeCssEscapes(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return plain
    .replace(/@\s*import\b(?:"[^"]*"|'[^']*'|[^;{}])*(?:;|$)/gi, '')
    .replace(/url\s*\(([^)]*)\)/gi, (_, raw: string) => {
      const target = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
      return LOCAL_FRAGMENT.test(target) ? `url(${target})` : 'none';
    })
    .replace(/url\s*\([^)]*$/gi, 'none')
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/(?:behavior|-moz-binding)\s*:[^;{}]*/gi, '');
}

function sanitizeAttribute(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || FORBIDDEN_ATTRS.has(lower)) return null;
  if (lower === 'href' || lower === 'xlink:href' || lower.endsWith(':href')) {
    return LOCAL_FRAGMENT.test(value.trim()) ? value.trim() : null;
  }
  if (lower === 'style' || URL_BEARING_ATTRS.has(lower)) {
    return sanitizeSvgCss(value);
  }
  return value;
}

function sanitizeDomTree(svg: Element): void {
  const walk = (node: Element, parentIsRoot: boolean) => {
    for (const child of Array.from(node.children)) {
      const tag = child.localName.toLowerCase();
      if (FORBIDDEN_SVG_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      if (tag === 'style') {
        if (!parentIsRoot) {
          child.remove();
          continue;
        }
        child.textContent = sanitizeSvgCss(child.textContent ?? '');
        for (const attr of Array.from(child.attributes)) {
          if (attr.name.toLowerCase() !== 'type') child.removeAttribute(attr.name);
        }
        continue;
      }
      if (tag === 'a') {
        // Unwrap links so no clickable external or javascript: navigation survives.
        walk(child, false);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const clean = sanitizeAttribute(attr.name, attr.value);
        if (clean === null) child.removeAttribute(attr.name);
        else if (clean !== attr.value) child.setAttribute(attr.name, clean);
      }
      walk(child, false);
    }
  };

  for (const attr of Array.from(svg.attributes)) {
    const clean = sanitizeAttribute(attr.name, attr.value);
    if (clean === null) svg.removeAttribute(attr.name);
    else if (clean !== attr.value) svg.setAttribute(attr.name, clean);
  }
  walk(svg, true);
}

/** String-level fallback when DOMParser is unavailable (e.g. Node unit tests). */
function sanitizeSvgFallback(svg: string): string {
  if (!/<svg\b/i.test(svg)) throw new Error('Invalid Mermaid SVG');
  let out = svg;
  for (const tag of FORBIDDEN_SVG_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // Unwrap <a> tags.
  out = out.replace(/<\/?a(?:\s[^>]*)?>/gi, '');
  // Sanitize <style> blocks.
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_, _attrs: string, body: string) => `<style>${sanitizeSvgCss(body)}</style>`);
  // Sanitize attributes on remaining tags.
  out = out.replace(/<([A-Za-z][\w:-]*)(\s[^>]*?)(\/?)>/g, (_full, tag: string, rawAttrs: string, selfClose: string) => {
    const cleanAttrs = rawAttrs.replace(/\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (_m, name: string, d?: string, s?: string, u?: string) => {
      const val = d ?? s ?? u ?? '';
      const clean = sanitizeAttribute(name, val);
      if (clean === null) return '';
      const escaped = clean.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return ` ${name}="${escaped}"`;
    });
    return `<${tag}${cleanAttrs}${selfClose}>`;
  });
  return out;
}

/**
 * Sanitizes Mermaid's rendered SVG to guarantee zero network requests, zero
 * script execution, and zero foreign HTML embeds even if a Mermaid directive
 * or diagram renderer produces unexpected markup.
 */
export function sanitizeMermaidSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return sanitizeSvgFallback(svg);
  }
  const parser = new DOMParser();
  const xml = parser.parseFromString(svg, 'image/svg+xml');
  let root: Element | null =
    xml.documentElement?.localName.toLowerCase() === 'svg' && xml.getElementsByTagName('parsererror').length === 0
      ? xml.documentElement
      : null;
  if (!root) {
    const html = parser.parseFromString(svg, 'text/html');
    root = html.body.querySelector('svg');
  }
  if (!root) throw new Error('Invalid Mermaid SVG');
  sanitizeDomTree(root);
  return new XMLSerializer().serializeToString(root);
}
