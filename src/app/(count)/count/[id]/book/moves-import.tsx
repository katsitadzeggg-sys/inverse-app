'use client';

import { useState, useTransition } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert } from '@/components/ui';
import { importMoves, type MoveRow } from '../../actions';

type Cell = string | number | boolean | Date | null;

const BARCODE = /(შტრიხ|ბარკოდ|barcode|штрих|ean|gtin)/i;
const CODE = /(არტიკ|კოდ|code|sku|артикул|код)/i;
const QTY = /(რაოდ|qty|quant|кол)/i;
const DATE_HEAD = /(თარიღ|date|дата)/i;

/** "09.11.2026 г.", "2026-11-09", a Date cell → "2026-11-09". */
function dayOf(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const t = String(v ?? '');
  let m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const num = (v: Cell) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));
const text = (v: Cell) => (v == null ? '' : String(v).trim());

/**
 * Reads a turnover report. Two shapes:
 *  - days across (1C "sales by days"): a header row with the barcode column,
 *    one column group per day ("09.11.2026") with "რაოდენობა" under it;
 *  - one line per product and day: barcode / code, date, quantity columns.
 */
function parse(rows: Cell[][]): { moves: MoveRow[]; days: string[] } | string {
  const h = rows.slice(0, 40).findIndex((r) => r.some((c) => BARCODE.test(text(c))));
  if (h < 0) return 'შტრიხკოდის სვეტი ვერ ვიპოვე.';
  const head = rows[h].map(text);
  const bc = head.findIndex((c) => BARCODE.test(c));
  const cc = head.findIndex((c, i) => i !== bc && CODE.test(c) && !BARCODE.test(c));
  const sub = (rows[h + 1] ?? []).map(text);
  const moves: MoveRow[] = [];

  // Days across: date cells in the header row.
  const dates = head
    .map((c, i) => ({ i, day: dayOf(c) }))
    .filter((d): d is { i: number; day: string } => !!d.day);
  if (dates.length) {
    const cols = dates.map((d, k) => {
      const end = dates[k + 1]?.i ?? d.i + 3;
      let q = d.i;
      for (let c = d.i; c < end; c++)
        if (QTY.test(sub[c] ?? '')) {
          q = c;
          break;
        }
      return { col: q, day: d.day };
    });
    const start = QTY.test(sub.join(' ')) ? h + 2 : h + 1;
    for (const r of rows.slice(start)) {
      const barcode = text(r[bc]);
      const code = cc >= 0 ? text(r[cc]) : '';
      if (!barcode && !code) continue;
      for (const { col, day } of cols) {
        const q = num(r[col]);
        if (Number.isFinite(q) && q !== 0) moves.push({ barcode, code, day, qty: q });
      }
    }
  } else {
    // One line per product and day.
    const dc = head.findIndex((c) => DATE_HEAD.test(c));
    const qc = head.findIndex((c) => QTY.test(c));
    if (dc < 0 || qc < 0) return 'თარიღის ან რაოდენობის სვეტი ვერ ვიპოვე.';
    for (const r of rows.slice(h + 1)) {
      const barcode = text(r[bc]);
      const code = cc >= 0 ? text(r[cc]) : '';
      const day = dayOf(r[dc]);
      const q = num(r[qc]);
      if ((barcode || code) && day && Number.isFinite(q) && q !== 0)
        moves.push({ barcode, code, day, qty: q });
    }
  }
  if (!moves.length) return 'ფაილში ბრუნვის ხაზი ვერ ვიპოვე.';
  return { moves, days: [...new Set(moves.map((m) => m.day))].sort() };
}

const fmtDay = (d: string) => d.split('-').reverse().join('.');

/** Turnover of the counting days: products counted on a day they moved go to "to re-check". */
export default function MovesImport({ stocktakeId, loaded }: { stocktakeId: string; loaded: number }) {
  const [data, setData] = useState<{ moves: MoveRow[]; days: string[] } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      <div>
        <h2 className="text-base font-semibold">🔁 ბრუნვა დათვლის დღეებში</h2>
        <p className="text-sm text-ink-soft">
          გაყიდვები, შესყიდვები, გადაადგილება — დღეების მიხედვით. პროდუქტი, რომელიც იმ დღეს დაითვალეს,
          როცა ბრუნვა ჰქონდა, „გადასამოწმებელში“ მოხვდება.
          {loaded > 0 && ` ახლა ჩატვირთულია ${loaded} ხაზი; ახალი ფაილი ძველს ჩაანაცვლებს.`}
        </p>
      </div>
      <input
        type="file"
        accept=".xlsx"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setData(null);
          setMsg(null);
          if (!f) return;
          try {
            const sheets = await readXlsxFile(f);
            const r = parse(sheets as unknown as Cell[][]);
            if (typeof r === 'string') setMsg({ tone: 'error', text: r });
            else setData(r);
          } catch {
            setMsg({ tone: 'error', text: 'ფაილი ვერ წავიკითხე (საჭიროა .xlsx).' });
          }
        }}
        className="text-sm"
      />
      {data && (
        <>
          <p className="text-sm">
            {data.moves.length} ხაზი ·{' '}
            {new Set(data.moves.map((m) => m.barcode || m.code)).size} პროდუქტი · დღეები:{' '}
            {data.days.map(fmtDay).join(', ')}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const PART = 2000;
                let lines = 0;
                let unknown = 0;
                for (let i = 0; i < data.moves.length; i += PART) {
                  setMsg({ tone: 'info', text: `იტვირთება… ${i} / ${data.moves.length}` });
                  const r = await importMoves(stocktakeId, data.moves.slice(i, i + PART), i > 0);
                  if (r.error) return setMsg({ tone: 'error', text: r.error });
                  lines += r.lines ?? 0;
                  unknown += r.unknown ?? 0;
                }
                setMsg({
                  tone: 'info',
                  text: `ჩაიტვირთა ${lines} ხაზი.${unknown ? ` სისტემაში უცნობი კოდი: ${unknown} ხაზი (გამოტოვდა).` : ''}`,
                });
                setData(null);
              })
            }
            className="w-fit rounded-control bg-ink px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
          >
            {pending ? 'იტვირთება…' : 'ბრუნვის ჩატვირთვა'}
          </button>
        </>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </section>
  );
}
