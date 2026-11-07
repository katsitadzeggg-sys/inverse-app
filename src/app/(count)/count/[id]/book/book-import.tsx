'use client';

import { useState, useTransition } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert } from '@/components/ui';
import { fmtDate, parseDate } from '@/lib/expiry';
import { importBook, type BookRow } from '../../actions';

type Field =
  'barcode' | 'code' | 'name' | 'location' | 'qty' | 'unit' | 'cost' | 'expiry' | 'group';

// Header words seen in exports from Balance, FINA, 1C and hand-made sheets.
const GUESS: Record<Field, RegExp> = {
  barcode: /(შტრიხ|ბარკოდ|barcode|штрих|ean|gtin)/i,
  code: /(კოდ|code|sku|არტიკ|артикул|код)/i,
  name: /(დასახ|სახელ|name|наимен|название|პროდუქ|საქონ)/i,
  location: /(თარო|ადგილ|ლოკაც|უჯრ|location|shelf|bin|ячейк|место)/i,
  qty: /(ნაშთ|რაოდ|qty|quant|кол|остат|balance)/i,
  unit: /(ერთეულ|ზომის|unit|uom|ед\.?\s*изм|единиц)/i,
  cost: /(ფასი|თვითღ|ღირებ|cost|price|цена|себест)/i,
  expiry: /(ვადა|ვარგ|expir|exp\b|best before|срок|годен)/i,
  group: /(ჯგუფ|კატეგ|group|categ|группа|категор)/i,
};

const LABELS: Record<Field, string> = {
  name: 'დასახელება *',
  barcode: 'შტრიხკოდი *',
  location: 'თაროს ნომერი',
  qty: 'ნაშთი *',
  unit: 'ზომის ერთეული',
  code: 'შიდა კოდი / არტიკული',
  cost: 'ერთეულის ფასი',
  expiry: 'ვარგისიანობის ვადა',
  group: 'ჯგუფი',
};

function parseCsv(text: string): string[][] {
  const sep =
    (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}

const num = (v: string) =>
  Number(
    String(v ?? '')
      .replace(/\s/g, '')
      .replace(',', '.'),
  );

export default function BookImport({
  stocktakeId,
  expiry = false,
}: {
  stocktakeId: string;
  expiry?: boolean;
}) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<Record<Field, number>>({
    barcode: -1,
    code: -1,
    name: -1,
    location: -1,
    qty: -1,
    unit: -1,
    cost: -1,
    expiry: -1,
    group: -1,
  });
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    setMsg(null);
    let rows: string[][];
    try {
      if (/\.(xlsx|xlsm)$/i.test(file.name)) {
        // A date cell comes as a Date at UTC midnight: keep it as YYYY-MM-DD.
        rows = (await readXlsxFile(file)).map((r) =>
          r.map((c) =>
            c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c),
          ),
        );
      } else {
        rows = parseCsv(await file.text());
      }
    } catch {
      setTable(null);
      setMsg({
        tone: 'error',
        text: 'ფაილი ვერ წავიკითხე. გახსენი Excel-ში, შეინახე (Save) და თავიდან აირჩიე — ან ატვირთე CSV-ად.',
      });
      return;
    }
    // The header is the first row in the top ten that names a code and a quantity.
    const h = Math.max(
      0,
      rows
        .slice(0, 10)
        .findIndex(
          (r) =>
            r.some((c) => GUESS.code.test(c) || GUESS.barcode.test(c)) &&
            r.some((c) => GUESS.qty.test(c)),
        ),
    );
    const header = rows[h] ?? [];
    const guess = Object.fromEntries(
      (Object.keys(GUESS) as Field[]).map((f) => [
        f,
        // "შტრიხკოდი" also contains "კოდ": a barcode column is not the article code.
        header.findIndex((c) => GUESS[f].test(c) && !(f === 'code' && GUESS.barcode.test(c))),
      ]),
    ) as Record<Field, number>;
    setTable(rows);
    setHeaderRow(h);
    setMap(guess);
  }

  const header = table?.[headerRow] ?? [];
  const body = table ? table.slice(headerRow + 1).filter((r) => r.some((c) => c !== '')) : [];
  const cell = (r: string[], f: Field) => (map[f] >= 0 ? (r[map[f]] ?? '') : '');
  const preview: BookRow[] = body.map((r) => ({
    barcode: cell(r, 'barcode'),
    unit: cell(r, 'unit'),
    code: map.code >= 0 ? (r[map.code] ?? '') : '',
    name: map.name >= 0 ? (r[map.name] ?? '') : '',
    location: map.location >= 0 ? (r[map.location] ?? '') : '',
    qty: map.qty >= 0 ? num(r[map.qty]) : NaN,
    cost: map.cost >= 0 && r[map.cost] !== '' ? num(r[map.cost]) : null,
    expiry: expiry && map.expiry >= 0 ? parseDate(r[map.expiry]) : null,
    group: cell(r, 'group'),
  }));
  const valid = preview.filter(
    (r) => (r.code.trim() || r.barcode.trim()) && Number.isFinite(r.qty),
  );

  return (
    <div className="grid gap-4">
      <label className="grid cursor-pointer gap-2 rounded-control border-2 border-dashed border-rule-strong p-6 text-center">
        <span className="text-base font-semibold">📄 აირჩიე Excel ან CSV ფაილი</span>
        <span className="text-sm text-ink-faint">
          საჭიროა: დასახელება, შტრიხკოდი, ჯგუფი, ნაშთი, თაროს ნომერი
          {expiry ? ', ვარგისიანობის ვადა (ყოველ პარტიას თავისი ხაზი)' : ''}. ზომის ერთეული —
          სურვილისამებრ (თუ არ წერია, „ცალი“)
        </span>
        <input
          type="file"
          accept=".xlsx,.xlsm,.csv,.txt"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        />
      </label>

      {table && (
        <>
          <div className="grid gap-2 rounded-control border border-rule/70 p-4">
            <p className="text-sm font-semibold">სვეტები</p>
            {(Object.keys(LABELS) as Field[])
              .filter((f) => expiry || f !== 'expiry')
              .map((f) => (
                <label key={f} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
                  <span>{LABELS[f]}</span>
                  <select
                    value={map[f]}
                    onChange={(e) => setMap({ ...map, [f]: Number(e.target.value) })}
                    className="rounded-control border border-rule-strong bg-paper-sunk px-2 py-1.5"
                  >
                    <option value={-1}>—</option>
                    {header.map((c, i) => (
                      <option key={i} value={i}>
                        {c || `სვეტი ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>

          <div className="overflow-x-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left">
                <tr>
                  <th className="p-2">დასახელება</th>
                  <th className="p-2">შტრიხკოდი</th>
                  <th className="p-2">თარო</th>
                  <th className="p-2 text-right">ნაშთი</th>
                  <th className="p-2">ერთ.</th>
                  {expiry && <th className="p-2">ვადა</th>}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-rule/60">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.barcode || r.code}</td>
                    <td className="p-2">{r.location}</td>
                    <td
                      className={`p-2 text-right ${Number.isFinite(r.qty) ? '' : 'text-mismatch'}`}
                    >
                      {Number.isFinite(r.qty) ? r.qty : '?'}
                    </td>
                    <td className="p-2 text-ink-faint">{r.unit || 'ცალი'}</td>
                    {expiry && (
                      <td className={`p-2 ${r.expiry ? '' : 'text-review'}`}>
                        {fmtDate(r.expiry)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-2 text-xs text-ink-faint">
              სულ {body.length} ხაზი, აქედან სწორი {valid.length}.
            </p>
          </div>

          <button
            type="button"
            disabled={pending || !valid.length}
            onClick={() =>
              start(async () => {
                const res = await importBook(stocktakeId, valid);
                setMsg(
                  res.error
                    ? { tone: 'error', text: res.error }
                    : { tone: 'info', text: res.notice ?? 'ჩაიტვირთა' },
                );
              })
            }
            className="rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper disabled:opacity-50"
          >
            {pending ? 'იტვირთება…' : `ნაშთის ჩატვირთვა (${valid.length})`}
          </button>
        </>
      )}

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
