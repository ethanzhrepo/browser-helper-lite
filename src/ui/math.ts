/**
 * Prepares math for remark-math:
 * - display math written as `$$x$$` alone on a line, or `\[x\]`, becomes a
 *   `$$` block (remark-math needs the fences on their own lines);
 * - `\(x\)` becomes `$x$`;
 * - a `$` followed by a digit is a price ("$40/mo and $65/mo"), not math, so
 *   it is escaped.
 * Code blocks and inline code are left alone.
 */
export function normalizeMath(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, math: string) => `$$\n${math.trim()}\n$$`)
            .replace(/(?<![\\$])\$(?=\d)/g, '\\$')
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
            .replace(/\\\((.+?)\\\)/g, (_, math: string) => `$${math.trim()}$`),
    )
    .join('');
}
