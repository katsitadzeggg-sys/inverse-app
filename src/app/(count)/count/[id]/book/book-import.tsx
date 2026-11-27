'use client';

import { useState, useTransition, type ReactNode } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert } from '@/components/ui';
import { parseDate } from '@/lib/expiry';
import { bookOverlap, importBook, spreadBook, type BookRow } from '../../actions';

type Field =
  | 'barcode'
  | 'barcode2'
  | 'code'
  | 'name'
  | 'location'
  | 'qty'
  | 'unit'
  | 'cost'
  | 'expiry'
  | 'group';

// Header words seen in exports from Balance, FINA, 1C and hand-made sheets.
const GUESS: Record<Field, RegExp> = {
  barcode: /(შტრიხ|ბარკოდ|barcode|штрих|ean|gtin)/i,
  barcode2:
    /((შტრიხ|ბარკოდ|barcode|штрих|ean).*(2|მეორე|დამატ|alt|second|доп)|(მეორე|დამატებით|alt|second|доп).*(შტრიხ|ბარკოდ|barcode|штрих|ean))/i,
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
  barcode2: 'მეორე შტრიხკოდი',
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
  children,
  cardClass = '',
  replace = false,
}: {
  stocktakeId: string;
  expiry?: boolean;
  /** Shown in the card above the button (title, template link). */
  children?: ReactNode;
  cardClass?: string;
  /** A balance is loaded already: the button says "new". */
  replace?: boolean;
}) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<Record<Field, number>>({
    barcode: -1,
    barcode2: -1,
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
  const [done, setDone] = useState<{
    lines: number;
    created: number;
    shelves: number;
    notice?: string;
    warn?: string;
  } | null>(null);
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  // Few products in common with this warehouse: asked once before loading.
  const [foreign, setForeign] = useState<{ common: number; total: number } | null>(null);

  async function load(file: File) {
    setMsg(null);
    setDone(null);
    setForeign(null);
    setFileName(file.name);
    let rows: string[][];
    if (/\.xls$/i.test(file.name)) {
      setMsg({
        tone: 'error',
        text: 'ეს ძველი .xls ფორმატია — Excel-ში გახსენი და შეინახე როგორც .xlsx (File → Save As → Excel Workbook), მერე ატვირთე.',
      });
      return;
    }
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
        header.findIndex(
          (c) =>
            GUESS[f].test(c) &&
            // "შტრიხკოდი" also contains "კოდ": a barcode column is not the article code;
            // and the main barcode is not the second one.
            !(f === 'code' && GUESS.barcode.test(c)) &&
            !(f === 'barcode' && GUESS.barcode2.test(c)) &&
            // "ერთეულის ფასი" (unit price) is the price, not the unit of measure.
            !(f === 'unit' && GUESS.cost.test(c)),
        ),
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
    // A number is never a unit of measure (a price column picked by mistake).
    unit: /^[\d.,\s]+$/.test(cell(r, 'unit')) ? '' : cell(r, 'unit'),
    code: map.code >= 0 ? (r[map.code] ?? '') : '',
    name: map.name >= 0 ? (r[map.name] ?? '') : '',
    location: map.location >= 0 ? (r[map.location] ?? '') : '',
    qty: map.qty >= 0 ? num(r[map.qty]) : NaN,
    cost: map.cost >= 0 && r[map.cost] !== '' ? num(r[map.cost]) : null,
    expiry: expiry && map.expiry >= 0 ? parseDate(r[map.expiry]) : null,
    group: cell(r, 'group'),
    barcode2: cell(r, 'barcode2'),
  }));
  const valid = preview.filter(
    (r) => (r.code.trim() || r.barcode.trim()) && Number.isFinite(r.qty),
  );

  // What the file holds, at a glance (instead of its lines).
  const sum = (() => {
    const skus = new Set<string>();
    const shelves = new Set<string>();
    const seen = new Set<string>();
    let qty = 0;
    let money = 0;
    const miss = {
      name: 0,
      barcode: 0,
      cost: 0,
      group: 0,
      shelf: 0,
      badQty: 0,
      neg: 0,
      zero: 0,
      dup: 0,
      second: 0,
    };
    for (const r of preview) {
      if (!Number.isFinite(r.qty)) {
        miss.badQty += 1;
        continue;
      }
      if (!(r.code.trim() || r.barcode.trim())) continue;
      const key = r.barcode.trim() || r.code.trim();
      skus.add(key);
      const loc = r.location.trim();
      if (loc && !/^(0+|[-–—]+)$/.test(loc)) shelves.add(loc);
      else miss.shelf += 1;
      const k2 = `${key}|${loc}|${r.expiry ?? ''}`;
      if (seen.has(k2)) miss.dup += 1;
      seen.add(k2);
      qty += r.qty;
      if (r.cost != null && Number.isFinite(r.cost)) money += r.qty * r.cost;
      else miss.cost += 1;
      if (!r.name.trim()) miss.name += 1;
      if (!r.barcode.trim()) miss.barcode += 1;
      if (!(r.group ?? '').trim()) miss.group += 1;
      if (r.qty < 0) miss.neg += 1;
      if (r.qty === 0) miss.zero += 1;
      if ((r.barcode2 ?? '').trim()) miss.second += 1;
    }
    return { skus: skus.size, shelves: shelves.size, qty, money, miss };
  })();
  // One column feeds one field: two fields on the same column is a wrong match.
  const clash = (Object.keys(LABELS) as Field[])
    .filter((f) => map[f] >= 0 && (expiry || f !== 'expiry'))
    .reduce((m, f) => m.set(map[f], [...(m.get(map[f]) ?? []), f]), new Map<number, Field[]>());
  const clashes = [...clash.entries()].filter(([, fs]) => fs.length > 1);
  const required: Field[] = ['name', 'barcode', 'qty'];
  const lacking = required.filter((f) => map[f] < 0 && !(f === 'barcode' && map.code >= 0));
  const n = (v: number) => v.toLocaleString('ka-GE', { maximumFractionDigits: 2 });
  const warn: [number, string, 'error' | 'warn'][] = (
    [
      [sum.miss.badQty, 'ხაზი ნაშთის გარეშე / არარიცხვითი ნაშთით — არ ჩაიტვირთება', 'error'],
      // Every line on one shelf: almost surely not the shelf column.
      [
        map.location >= 0 && sum.shelves === 1 && valid.length > 20 ? valid.length : 0,
        'ყველა ხაზი ერთ თაროზეა — ალბათ სხვა სვეტი აირჩა თაროდ. თუ თაროები ფაილში არ გაქვს, „თაროს ნომერი“ ქვემოთ „—“-ზე დააყენე',
        'error',
      ],
      [sum.miss.name, 'დასახელების გარეშე', 'warn'],
      [map.barcode >= 0 ? sum.miss.barcode : 0, 'შტრიხკოდის გარეშე (კოდით ჩაიტვირთება)', 'warn'],
      [map.cost >= 0 ? sum.miss.cost : 0, 'ფასის გარეშე (თანხაში არ ითვლება)', 'warn'],
      [map.group >= 0 ? sum.miss.group : 0, 'ჯგუფის გარეშე', 'warn'],
      [map.location >= 0 ? sum.miss.shelf : 0, 'თაროს გარეშე (მთელ ობიექტს შეედარება)', 'warn'],
      [sum.miss.neg, 'უარყოფითი ნაშთით', 'warn'],
      [sum.miss.zero, 'ნულოვანი ნაშთით', 'warn'],
      [sum.miss.dup, 'განმეორებადი (იგივე კოდი იმავე თაროზე — შეიკრიბება)', 'warn'],
    ] as [number, string, 'error' | 'warn'][]
  ).filter(([c]) => c > 0);

  // The card holds the button; what the file holds opens full width below
  // the row of cards (the parent grid gives it all columns).
  return (
    <>
      <section className={cardClass}>
        {children}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-3 text-base font-semibold text-white hover:bg-[#155c39]">
          📂 {replace ? 'ახალი ნაშთის ატვირთვა' : 'ნაშთის ატვირთვა'}
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) load(f);
            }}
          />
        </label>
        <a
          href="/templates/nashti-shabloni.xlsx"
          download
          className="text-center text-sm text-[#1f7a4d] underline decoration-dotted"
        >
          ⬇ შაბლონის ჩამოტვირთვა
        </a>
      </section>
      {(table || done || msg) && (
        <div className="grid gap-4 lg:col-span-3">
          {table && (
            <>
              {/* What the file holds: counts, shelves and what is missing. */}
              <div className="grid gap-2 rounded-xl border border-rule/70 p-3">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {(
                    [
                      [
                        'ხაზი',
                        `${valid.length}${valid.length !== body.length ? ` / ${body.length}` : ''}`,
                      ],
                      ['SKU', n(sum.skus)],
                      ['ჯამური ნაშთი', n(Math.round(sum.qty))],
                      ['თარო', map.location >= 0 ? n(sum.shelves) : '—'],
                      ...(map.cost >= 0 ? [['თანხა', `${n(Math.round(sum.money))} ₾`]] : []),
                      ...(map.barcode2 >= 0 ? [['მეორე შტრიხკოდი', n(sum.miss.second)]] : []),
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-paper-sunk px-2.5 py-1.5">
                      <p className="truncate text-[11px] text-ink-faint">{k}</p>
                      <p className="whitespace-nowrap text-base font-semibold tabular-nums">{v}</p>
                    </div>
                  ))}
                </div>
                {clashes.map(([col, fs]) => (
                  <p key={col} className="text-sm font-semibold text-mismatch">
                    ✗ ერთი სვეტი „{header[col] || `სვეტი ${col + 1}`}“ მიბმულია რამდენიმე ველზე:{' '}
                    {fs.map((f) => LABELS[f].replace(' *', '')).join(', ')} — ქვემოთ გაასწორე.
                  </p>
                ))}
                {lacking.length > 0 && (
                  <p className="text-sm font-semibold text-mismatch">
                    ✗ ვერ ვიპოვე სვეტი: {lacking.map((f) => LABELS[f].replace(' *', '')).join(', ')}{' '}
                    — მიუთითე ქვემოთ.
                  </p>
                )}
                {warn.length === 0 && lacking.length === 0 ? (
                  <p className="text-sm text-match">✓ ინფორმაცია სრულია.</p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {warn.map(([c, t, tone]) => (
                      <li key={t} className={tone === 'error' ? 'text-mismatch' : 'text-review'}>
                        ⚠ {t}: <b className="tabular-nums">{n(c)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {(['location', 'group', 'cost', 'barcode2'] as Field[])
                  .filter((f) => map[f] < 0)
                  .map((f) => LABELS[f])
                  .join(', ') && (
                  <p className="text-xs text-ink-faint">
                    ფაილში არ არის:{' '}
                    {(['location', 'group', 'cost', 'barcode2'] as Field[])
                      .filter((f) => map[f] < 0)
                      .map((f) => LABELS[f])
                      .join(', ')}
                    .
                  </p>
                )}
              </div>

              <details
                open={lacking.length > 0 || clashes.length > 0}
                className="rounded-xl border border-rule/70 px-4 py-2.5"
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  სვეტები — ავტომატურად ამოცნობილი (შეცვლა)
                </summary>
                <div className="mt-3 grid gap-2">
                  {(Object.keys(LABELS) as Field[])
                    .filter((f) => expiry || f !== 'expiry')
                    .map((f) => (
                      <label
                        key={f}
                        className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm"
                      >
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
              </details>

              <button
                type="button"
                disabled={pending || !valid.length || clashes.length > 0}
                onClick={() =>
                  start(async () => {
                    // Another warehouse's file? Compare with what this one knows.
                    if (!foreign) {
                      const codes = valid
                        .map((r) => r.barcode.trim() || r.code.trim())
                        .slice(0, 3000);
                      const o = await bookOverlap(stocktakeId, codes);
                      const total = new Set(codes).size;
                      if (o.known > 20 && total > 20 && o.common / total < 0.3) {
                        setForeign({ common: o.common, total });
                        return;
                      }
                    }
                    // Sent in parts of 1 000 rows: a big file does not fit in one request.
                    const PART = 1000;
                    let lines = 0;
                    let created = 0;
                    let shelves = 0;
                    for (let i = 0; i < valid.length; i += PART) {
                      setMsg({
                        tone: 'info',
                        text: `იტვირთება… ${Math.min(i + PART, valid.length)} / ${valid.length}`,
                      });
                      const res = await importBook(stocktakeId, valid.slice(i, i + PART), i > 0);
                      if (res.error) {
                        setMsg({
                          tone: 'error',
                          text: `${res.error} (ჩაიტვირთა ${i} ხაზი ${valid.length}-დან — ფაილი თავიდან ატვირთე)`,
                        });
                        return;
                      }
                      lines += res.lines ?? 0;
                      created += res.created ?? 0;
                      shelves += res.shelves ?? 0;
                    }
                    // The same balance to the other open stocktakes of the warehouse.
                    const spread = await spreadBook(stocktakeId, fileName ?? undefined);
                    setMsg(null);
                    setDone({ lines, created, shelves, ...spread });
                  })
                }
                className="rounded-xl bg-[#1f7a4d] px-4 py-3 text-base font-semibold text-white hover:bg-[#155c39] disabled:opacity-50"
              >
                {pending
                  ? 'იტვირთება…'
                  : foreign
                    ? `მაინც ჩატვირთე (${valid.length})`
                    : `ნაშთის ჩატვირთვა (${valid.length})`}
              </button>
              {foreign && (
                <Alert>
                  ⚠ ეს სხვა საწყობის ნაშთს ჰგავს: ფაილის {foreign.total} პროდუქტიდან ამ საწყობში
                  მხოლოდ {foreign.common} გვხვდება (ნაშთში ან დათვლილში). შეამოწმე ფაილი — თუ
                  სწორია, დააჭირე „მაინც ჩატვირთე“.
                </Alert>
              )}
            </>
          )}

          {done && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2fbf71]/40 bg-[#2fbf71]/10 px-4 py-3">
              <p className="text-base font-semibold text-[#2fbf71]">✓ ნაშთი ჩაიტვირთა</p>
              <div className="flex flex-wrap gap-2 text-center">
                {(
                  [
                    ['პოზიცია', done.lines],
                    ['ახალი პროდუქტი', done.created],
                    ['ახალი თარო', done.shelves],
                  ] as [string, number][]
                ).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-paper px-3 py-1">
                    <p className="text-base font-semibold tabular-nums">
                      {v.toLocaleString('ka-GE')}
                    </p>
                    <p className="text-[11px] text-ink-faint">{k}</p>
                  </div>
                ))}
              </div>
              {done.notice && <p className="basis-full text-sm text-ink-soft">{done.notice}</p>}
              {done.warn && <p className="basis-full text-sm text-review">ℹ {done.warn}</p>}
            </div>
          )}
          {msg && (
            <Alert tone={msg.tone}>
              <span className="whitespace-pre-line">{msg.text}</span>
            </Alert>
          )}
        </div>
      )}
    </>
  );
}
