/** Sorting and exporting the tables in replies. */

/** "$1,299.00", "65 %", "12.5 GB", "¥5" → the number a cell starts with; undefined when it is not one. */
export function numberOf(text: string): number | undefined {
  const match = /^[^\d+-]{0,4}([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![\d/:-])/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The order of the rows when sorted by a column. Numbers sort as numbers when
 * most of the column is numbers; cells without a value go last either way.
 */
export function sortOrder(rows: string[][], column: number, descending: boolean): number[] {
  const cells = rows.map((row) => (row[column] ?? '').trim());
  const numbers = cells.map(numberOf);
  const filled = cells.filter(Boolean).length;
  const numeric = filled > 0 && numbers.filter((n) => n !== undefined).length >= filled * 0.6;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const empty = (i: number) => (numeric ? numbers[i] === undefined : !cells[i]);
  return rows
    .map((_, i) => i)
    .sort((a, b) => {
      if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
      const order = numeric ? (numbers[a] ?? 0) - (numbers[b] ?? 0) : collator.compare(cells[a]!, cells[b]!);
      return (descending ? -order : order) || a - b;
    });
}

/** Comma-separated values, quoted where needed. A leading =, +, - or @ is kept from running as a formula in a spreadsheet. */
export function toCsv(rows: string[][]): string {
  const cell = (text: string) => {
    // A plain number such as -5 or +1.5% stays as it is.
    const value = /^[=+\-@]/.test(text) && !/^[+-]?[\d.,]+\s?%?$/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
