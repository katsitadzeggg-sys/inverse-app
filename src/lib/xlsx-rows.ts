/**
 * Row height for an Excel row with wrapped text. Excel does not grow rows by
 * itself for files written by a library, so long names were squeezed into one
 * line. Estimate the lines each cell needs from its column width (Georgian
 * letters are a little wider than Latin) and size the row for the tallest.
 */
export function rowHeight(values: (string | number | null | undefined)[], widths: number[], fontPt = 10): number {
  const lineH = Math.round(fontPt * 1.45);
  let lines = 1;
  values.forEach((v, i) => {
    if (v == null) return;
    const text = String(v);
    const w = Math.max(3, (widths[i] ?? 10) - 1);
    const georgian = /[Ⴀ-ჿ]/.test(text) ? 1.2 : 1;
    const need = text.split('\n').reduce((s, part) => s + Math.max(1, Math.ceil((part.length * georgian) / w)), 0);
    lines = Math.max(lines, need);
  });
  return lines * lineH + 4;
}
