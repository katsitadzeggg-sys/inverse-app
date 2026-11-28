/**
 * Turns what the manager types or uploads into label data: shelf ranges
 * ("AA1-AA25, AB1-AB23"), Excel rows of shelves, products and fixed assets.
 * Pure functions (no browser, no database) so they are tested on their own.
 */
import type { LabelData } from './zebra';

/** The most labels one range text may produce (a typo like AA1-AA99999). */
export const MAX_RANGE_LABELS = 5000;

export type RangeResult = { codes: string[]; errors: string[] };

/**
 * "AA1-AA25, AB1-AB23, C-01-C-12, D5" → every code, in order.
 * A range keeps the letters and the zero-padding of its first code
 * (A-01…A-12 stays two-digit). Separators: comma, semicolon, new line.
 */
export function parseRanges(text: string): RangeResult {
  const codes: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      codes.push(c);
    }
  };
  for (const raw of text.split(/[,;\n]+/)) {
    const part = raw.trim().toUpperCase();
    if (!part) continue;
    // PREFIX + number, then "-", "–" or "..", then (optional same PREFIX) + number.
    const m = part.match(/^(.*?)(\d+)\s*(?:\.\.|[-–]|\s+[-–]\s+)\s*(.*?)(\d+)$/);
    const prefix = m?.[1] ?? '';
    const prefix2 = m?.[3] ?? '';
    if (m && (prefix2 === '' || prefix2 === prefix)) {
      const from = Number(m[2]);
      const to = Number(m[4]);
      if (to < from) {
        errors.push(`${raw.trim()}: „მდე“ ნაკლებია „დან“-ზე`);
        continue;
      }
      if (to - from + 1 + codes.length > MAX_RANGE_LABELS) {
        errors.push(`${raw.trim()}: ზედმეტად ბევრია (მაქს. ${MAX_RANGE_LABELS})`);
        continue;
      }
      // Zero-padded when the first number was written with a leading zero.
      const width = m[2].length > 1 && m[2].startsWith('0') ? m[2].length : 0;
      for (let n = from; n <= to; n++) add(`${prefix}${String(n).padStart(width, '0')}`);
    } else {
      add(part);
    }
  }
  return { codes, errors };
}

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Index of the first header cell matching any of the words, or -1. */
function col(header: string[], words: string[]): number {
  return header.findIndex((h) => words.some((w) => h.includes(w)));
}

/** First row that looks like a header (has one of the words), else -1. */
function headerRow(rows: string[][], words: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(norm);
    if (h.some((c) => words.some((w) => c.includes(w)))) return i;
  }
  return -1;
}

const clean = (v: unknown) => String(v ?? '').trim();

/** A number cell as a whole count of labels (≥ 0), or null when not a number. */
function qty(v: unknown): number | null {
  const s = clean(v).replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.ceil(n)) : null;
}

const SHELF_CODE = ['თარო', 'კოდი', 'code', 'shelf', 'ადგილ', 'მისამართ'];
const SHELF_NAME = ['დასახელ', 'სახელ', 'name', 'აღწერ'];

/** Excel rows of shelves: code (+ name). Without a header: column A, B. */
export function shelvesFromRows(rows: string[][]): LabelData[] {
  const hr = headerRow(rows, [...SHELF_CODE, ...SHELF_NAME]);
  const h = hr >= 0 ? rows[hr].map(norm) : [];
  let ci = hr >= 0 ? col(h, SHELF_CODE) : 0;
  const ni = hr >= 0 ? col(h, SHELF_NAME) : 1;
  if (ci < 0) ci = 0;
  const out: LabelData[] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(hr + 1)) {
    const code = clean(r[ci]).toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = ni >= 0 && ni !== ci ? clean(r[ni]) : '';
    out.push({ code, title: name && name.toUpperCase() !== code ? name : 'თარო', mode: 'qr' });
  }
  return out;
}

const P_BARCODE = ['შტრიხ', 'barcode', 'ean'];
const P_CODE = ['არტიკ', 'კოდი', 'code', 'sku', 'article'];
const P_NAME = ['დასახელ', 'სახელ', 'name', 'პროდუქ'];
const P_QTY = ['რაოდ', 'ნაშთ', 'qty', 'quantity', 'ცალ'];

export type ProductLabel = LabelData;

/**
 * Excel rows of products: barcode, code/article, name, quantity.
 * The barcode is printed as bars; the code under it as "კოდი …".
 * Without a barcode the code itself becomes the bars.
 */
export function productsFromRows(rows: string[][]): ProductLabel[] {
  const hr = headerRow(rows, [...P_BARCODE, ...P_CODE, ...P_NAME, ...P_QTY]);
  const h = hr >= 0 ? rows[hr].map(norm) : [];
  const bi = hr >= 0 ? col(h, P_BARCODE) : 0;
  // "კოდი" must not match the barcode column ("შტრიხკოდი").
  // Without a header: A barcode, B name, C code, D quantity.
  const ci = hr >= 0 ? h.findIndex((c, i) => i !== bi && P_CODE.some((w) => c.includes(w))) : 2;
  const ni = hr >= 0 ? col(h, P_NAME) : 1;
  const qi = hr >= 0 ? col(h, P_QTY) : 3;
  const out: ProductLabel[] = [];
  for (const r of rows.slice(hr + 1)) {
    const barcode = bi >= 0 ? clean(r[bi]) : '';
    const code = ci >= 0 ? clean(r[ci]) : '';
    const main = barcode || code;
    if (!main) continue;
    const name = ni >= 0 ? clean(r[ni]) : '';
    out.push({
      code: main,
      title: name,
      sub: barcode && code && code !== barcode ? `კოდი ${code}` : undefined,
      mode: 'barcode',
      qty: qi >= 0 ? qty(r[qi]) : null,
    });
  }
  return out;
}

/** Pasted lines "barcode; name; code; qty" (tab works too, from Excel). */
export function productsFromText(text: string): ProductLabel[] {
  return productsFromRows(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/[;\t]/).map((c) => c.trim())),
  );
}

const A_CODE = ['ბუღ', 'საინვ', 'ინვენტ', 'კოდი', 'ნომერ', 'inv', 'code', '№'];
const A_NAME = ['დასახელ', 'სახელ', 'name', 'აღწერ'];

/**
 * Excel rows of fixed assets: accounting code + name. The accounting code is
 * the barcode, the QR and the printed number — nothing new is invented.
 * A row without a code gets an Inverse number (INV-0001…), marked as such.
 */
export function assetsFromRows(rows: string[][], start = 1): LabelData[] {
  const hr = headerRow(rows, [...A_CODE, ...A_NAME]);
  const h = hr >= 0 ? rows[hr].map(norm) : [];
  let ci = hr >= 0 ? col(h, A_CODE) : 0;
  let ni = hr >= 0 ? col(h, A_NAME) : 1;
  if (ci < 0) ci = 0;
  if (ni === ci) ni = -1;
  const out: LabelData[] = [];
  const seen = new Set<string>();
  let n = start;
  for (const r of rows.slice(hr + 1)) {
    const code = clean(r[ci]);
    const name = ni >= 0 ? clean(r[ni]) : '';
    if (!code && !name) continue;
    if (code) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ code, title: name, sub: 'ბუღ. №', mode: 'both' });
    } else {
      let inv = '';
      do inv = `INV-${String(n++).padStart(4, '0')}`;
      while (seen.has(inv));
      seen.add(inv);
      out.push({ code: inv, title: name, sub: 'Inverse №', mode: 'both' });
    }
  }
  return out;
}

/** Codes a line barcode cannot carry (Georgian letters etc.). */
export function notBarcodable(items: LabelData[]): string[] {
  return items.filter((i) => /[^\x20-\x7e]/.test(i.code)).map((i) => i.code);
}
