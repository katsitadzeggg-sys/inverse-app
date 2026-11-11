/**
 * Expiry dates: reading them from files, label text (OCR) and GS1 codes, and
 * the status the act groups them by. Shared by the browser and the server.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function valid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
  return iso(y, m, d);
}

/**
 * A date as people and programs write it → YYYY-MM-DD, or null.
 * Accepts DD.MM.YYYY, DD/MM/YY, DD-MM-YYYY, YYYY-MM-DD, MM/YYYY and MM.YY
 * (a month without a day means the last day of that month), an Excel serial
 * number, and a JS Date.
 */
export function parseDate(input: unknown): string | null {
  if (input == null || input === '') return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return valid(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  const s = String(input).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2,4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-./ ](\d{4}|\d{2})$/);
  if (m) {
    const y = +m[2] < 100 ? +m[2] + 2000 : +m[2];
    return valid(y, +m[1], lastDay(y, +m[1]));
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /[a-z]/i.test(s))
    return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

/**
 * Finds the expiry date in text read from a label. Prefers a date next to an
 * expiry word (EXP, BB, "ვარგ.", "годен до"…); otherwise takes the latest
 * date on the label, since the production date comes before the expiry.
 */
export function expiryFromText(text: string): string | null {
  const t = text.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/[|lI](?=\d{1,2}[./-])/g, '1');
  const re =
    /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{4}|\d{1,2}[./-]\d{2}(?![./-]?\d))/g;
  const found: { date: string; index: number }[] = [];
  for (const m of t.matchAll(re)) {
    const date = parseDate(m[0]);
    if (date) found.push({ date, index: m.index ?? 0 });
  }
  if (!found.length) return null;
  const word =
    /(exp|e\.?xp|best\s*before|bb|use\s*by|ვარგ|ვარგისია|მიიღეთ|годен|срок|до\b|son\s*kul|skt)/gi;
  for (const w of t.matchAll(word)) {
    const after = found.find((f) => f.index >= (w.index ?? 0) && f.index - (w.index ?? 0) < 40);
    if (after) return after.date;
  }
  return found
    .map((f) => f.date)
    .sort()
    .at(-1)!;
}

/**
 * A GS1 code (DataMatrix or GS1-128) → GTIN and expiry (AI 17, YYMMDD; day 00
 * means the end of the month). Handles "(01)…(17)…" and the raw form with the
 * FNC1 separator (\u001d). Returns null for a plain barcode.
 */
export function parseGs1(
  raw: string,
): { gtin: string; ean: string; expiry: string | null; batch: string | null } | null {
  const s = raw.replace(/^\]d2|^\]C1|^\]Q3/, '').trim();
  const fields = new Map<string, string>();
  if (s.includes('(')) {
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]+)/g)) fields.set(m[1], m[2].trim());
  } else if (/^01\d{14}/.test(s)) {
    const fixed: Record<string, number> = { '01': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
    let i = 0;
    while (i < s.length) {
      const ai = s.slice(i, i + 2);
      i += 2;
      if (fixed[ai]) {
        fields.set(ai, s.slice(i, i + fixed[ai]));
        i += fixed[ai];
      } else {
        const end = s.indexOf('\u001d', i);
        fields.set(ai, s.slice(i, end < 0 ? undefined : end));
        i = end < 0 ? s.length : end + 1;
      }
      if (s[i] === '\u001d') i += 1;
    }
  }
  const gtin = fields.get('01');
  if (!gtin || !/^\d{14}$/.test(gtin)) return null;
  const e = fields.get('17');
  let expiry: string | null = null;
  if (e && /^\d{6}$/.test(e)) {
    const y = 2000 + +e.slice(0, 2);
    const mo = +e.slice(2, 4);
    const d = +e.slice(4, 6);
    expiry = valid(y, mo, d === 0 ? lastDay(y, mo) : d);
  }
  return { gtin, ean: gtin.replace(/^0/, ''), expiry, batch: fields.get('10') ?? null };
}

export type ExpiryStatus = 'expired' | 'd15' | 'd40' | 'ok' | 'unknown';

export const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  expired: 'ვადაგასული',
  d15: '15 დღემდე',
  d40: '40 დღემდე',
  ok: 'ვადაში',
  unknown: 'ვადა უცნობია',
};

/** Status of a batch on the count date: expired, due within 15 or 40 days, fine, unknown. */
export function expiryStatus(
  expiry: string | null | undefined,
  on: string | Date = new Date(),
): ExpiryStatus {
  if (!expiry) return 'unknown';
  const day =
    typeof on === 'string'
      ? on.slice(0, 10)
      : iso(on.getFullYear(), on.getMonth() + 1, on.getDate());
  const days = Math.round((Date.parse(expiry) - Date.parse(day)) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 15) return 'd15';
  if (days <= 40) return 'd40';
  return 'ok';
}

export const fmtDate = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—';
