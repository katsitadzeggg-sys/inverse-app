'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import readXlsxFile from 'read-excel-file';
import type { LabelData, LabelMode } from '@/lib/zebra';
import {
  assetsFromRows,
  notBarcodable,
  parseRanges,
  productsFromRows,
  productsFromText,
  shelvesFromRows,
} from '@/lib/label-sources';
import ZebraPanel from '@/app/(count)/count/[id]/labels/zebra-panel';

type Tab = 'shelves' | 'products' | 'assets' | 'numbers' | 'stocktake';

const field =
  'h-10 rounded-xl border border-rule bg-paper px-3 text-sm outline-none focus:border-[#1f7a4d]';

/** An Excel (.xlsx) or CSV file as rows of text cells. */
async function readRows(file: File): Promise<string[][]> {
  if (/\.xls$/i.test(file.name))
    throw new Error('ძველი .xls — Excel-ში შეინახე როგორც .xlsx და ისე ატვირთე.');
  if (/\.(xlsx|xlsm)$/i.test(file.name))
    return (await readXlsxFile(file)).map((r) =>
      r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))),
    );
  const text = await file.text();
  const first = text.split('\n')[0];
  const sep = first.includes('\t')
    ? '\t'
    : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}

/**
 * The label studio: shelves (ranges like AA1-AA25, an Excel list or all the
 * company's shelves — QR + code + name on one sticker), products (barcode,
 * code and name; N copies each or one per unit of quantity), fixed assets
 * (the accounting code is the barcode and the number), numbered runs, or the
 * labels of one stocktake. Everything prints in one run.
 */
export default function LabelStudio({
  owner,
  appUrl,
  shelves,
  stocktakes,
  picked,
}: {
  owner: string;
  /** The app's address: fixed-asset QR codes link to {appUrl}/inv/{number}. */
  appUrl: string;
  /** The labels of the stocktake chosen in the URL (?st=…&src=…). */
  picked: {
    id: string;
    kind: string;
    number: string;
    src: 'shelves' | 'products' | 'assets';
    all: boolean;
    note: string;
    items: LabelData[];
  } | null;
  shelves: { code: string; name: string }[];
  stocktakes: { id: string; label: string }[];
}) {
  const [tab, setTab] = useState<Tab>(picked ? 'stocktake' : 'shelves');
  const [msg, setMsg] = useState<string | null>(null);

  // Shelves
  const [shelfSrc, setShelfSrc] = useState<'ranges' | 'excel' | 'company'>('ranges');
  const [ranges, setRanges] = useState('');
  const [shelfTitle, setShelfTitle] = useState('');
  const [shelfOwner, setShelfOwner] = useState(owner);
  const [shelfRows, setShelfRows] = useState<LabelData[]>([]);

  // Products
  const [prodSrc, setProdSrc] = useState<'excel' | 'paste'>('excel');
  const [prodRows, setProdRows] = useState<LabelData[]>([]);
  const [prodText, setProdText] = useState('');
  const [perUnit, setPerUnit] = useState(false);
  const [each, setEach] = useState(1);

  // Fixed assets
  const [assetRows, setAssetRows] = useState<string[][] | null>(null);
  const [invStart, setInvStart] = useState(1);

  // Numbered run
  const [prefix, setPrefix] = useState('A-');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(50);
  const [digits, setDigits] = useState(3);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<LabelMode>('qr');

  const [st, setSt] = useState(picked?.id ?? stocktakes[0]?.id ?? '');
  const [fileName, setFileName] = useState('');

  const parsed = useMemo(() => parseRanges(ranges), [ranges]);
  const count = Math.max(0, Math.min(5000, to - from + 1));

  const items: LabelData[] = useMemo(() => {
    /** N copies each, or one per unit of the quantity column. */
    const withCopies = (list: LabelData[]) =>
      list.map((d) => ({ ...d, copies: perUnit ? (d.qty ?? 0) : each }));
    if (tab === 'shelves') {
      const base =
        shelfSrc === 'ranges'
          ? parsed.codes.map((code) => ({ code, title: shelfTitle, mode: 'qr' as const }))
          : shelfSrc === 'excel'
            ? shelfRows
            : shelves.map((s) => ({
                code: s.code,
                title: s.name && s.name !== s.code ? s.name : '',
                mode: 'qr' as const,
              }));
      // Beside the QR: code / warehouse / company. The QR holds only the code.
      return base.map((d) => ({
        ...d,
        title: shelfTitle.trim() || d.title,
        footer: shelfOwner.trim() || undefined,
      }));
    }
    if (tab === 'products')
      return withCopies(prodSrc === 'excel' ? prodRows : productsFromText(prodText));
    if (tab === 'assets')
      return assetRows
        ? assetsFromRows(assetRows, invStart, appUrl).map((d) => ({ ...d, footer: owner }))
        : [];
    if (tab === 'numbers')
      return Array.from({ length: count }, (_, i) => ({
        code: `${prefix}${String(from + i).padStart(digits, '0')}`,
        title,
        footer: owner,
        mode,
      }));
    if (!picked || picked.id !== st) return [];
    return picked.src === 'products' ? withCopies(picked.items) : picked.items;
  }, [
    tab,
    shelfSrc,
    parsed,
    shelfTitle,
    shelfOwner,
    shelfRows,
    shelves,
    owner,
    prodSrc,
    prodRows,
    prodText,
    perUnit,
    each,
    assetRows,
    invStart,
    appUrl,
    count,
    prefix,
    from,
    digits,
    title,
    mode,
    picked,
    st,
  ]);

  // Assets without an accounting code got an Inverse number (INV-0001…).
  const noCode = tab === 'assets' ? items.filter((d) => /^INV-\d{4,}$/.test(d.code)).length : 0;
  const bad = tab === 'products' || tab === 'assets' ? notBarcodable(items) : [];
  const noQty =
    perUnit && (tab === 'products' || (tab === 'stocktake' && picked?.src === 'products'))
      ? items.filter((d) => d.qty == null).length
      : 0;

  async function upload(file: File | undefined, apply: (rows: string[][]) => void) {
    if (!file) return;
    setMsg(null);
    try {
      const rows = await readRows(file);
      setFileName(file.name.replace(/\.[^.]+$/, ''));
      apply(rows);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'ფაილი ვერ წავიკითხე.');
    }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(t);
        setMsg(null);
      }}
      className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t ? 'bg-[#1f7a4d] text-white' : 'border border-rule-strong hover:bg-paper-sunk'}`}
    >
      {label}
    </button>
  );
  const pill = (on: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ${on ? 'bg-ink text-paper' : 'border border-rule'}`}
    >
      {label}
    </button>
  );
  const fileInput = (apply: (rows: string[][]) => void) => (
    <input
      type="file"
      accept=".xlsx,.xlsm,.csv,.txt"
      className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-paper"
      onChange={(e) => upload(e.target.files?.[0], apply)}
    />
  );
  const copiesBox = (hasQty: boolean) => (
    <div className="grid gap-2 rounded-xl border border-rule p-3">
      <span className="text-xs text-ink-faint">რამდენი ცალი თითო პროდუქტზე</span>
      <div className="flex flex-wrap items-center gap-2">
        {pill(!perUnit, 'ერთნაირი რაოდენობა', () => setPerUnit(false))}
        {hasQty && pill(perUnit, 'ნაშთის რაოდენობით', () => setPerUnit(true))}
      </div>
      {!perUnit && (
        <input
          type="number"
          min={1}
          max={500}
          className={`${field} w-28`}
          value={each}
          onChange={(e) => setEach(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
          aria-label="ცალი თითოზე"
        />
      )}
      {perUnit && noQty > 0 && (
        <p className="text-xs text-[#b45309]">
          {noQty} პროდუქტს რაოდენობა არ აქვს — არ დაიბეჭდება.
        </p>
      )}
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-paper-sunk px-5 py-4">
        <h1 className="mr-3 text-2xl font-semibold">🏷 ეტიკეტები</h1>
        {tabBtn('shelves', '▦ თაროები')}
        {tabBtn('products', '║ პროდუქცია')}
        {tabBtn('assets', '№ ძირითადი საშუალებები')}
        {tabBtn('numbers', '# დანომრილი')}
        {tabBtn('stocktake', '📦 ინვენტარიზაციიდან')}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[24rem_1fr]">
        <section className="grid gap-3 rounded-2xl bg-paper-sunk p-5 text-sm">
          {tab === 'shelves' && (
            <>
              <div className="flex flex-wrap gap-2">
                {pill(shelfSrc === 'ranges', 'დიაპაზონით', () => setShelfSrc('ranges'))}
                {pill(shelfSrc === 'excel', 'Excel-იდან', () => setShelfSrc('excel'))}
                {pill(shelfSrc === 'company', `ყველა თარო (${shelves.length})`, () =>
                  setShelfSrc('company'),
                )}
              </div>
              {shelfSrc === 'ranges' && (
                <>
                  <label className="grid gap-1">
                    <span className="text-xs text-ink-faint">
                      თაროები, მძიმით: <code>AA1-AA25, AB1-AB23</code> (ცალკეულიც: <code>C7</code>)
                    </span>
                    <textarea
                      rows={4}
                      className="rounded-xl border border-rule bg-paper p-3 font-mono text-sm outline-none focus:border-[#1f7a4d]"
                      value={ranges}
                      placeholder="AA1-AA25, AB1-AB23"
                      onChange={(e) => setRanges(e.target.value)}
                    />
                  </label>

                  {parsed.errors.map((e) => (
                    <p key={e} className="text-xs text-[#b42318]">
                      {e}
                    </p>
                  ))}
                </>
              )}
              {shelfSrc === 'excel' && (
                <>
                  <p className="text-xs text-ink-faint">
                    სვეტები: <b>თაროს კოდი</b>, <b>დასახელება</b> (სათაურის გარეშეც — A და B სვეტი).
                  </p>
                  {fileInput((rows) => setShelfRows(shelvesFromRows(rows)))}
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-ink-faint">საწყობი / ფილიალი</span>
                  <input
                    className={field}
                    value={shelfTitle}
                    placeholder="მაგ. მელიქიშვილი"
                    onChange={(e) => setShelfTitle(e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-ink-faint">კომპანია</span>
                  <input
                    className={field}
                    value={shelfOwner}
                    placeholder="მაგ. სს ექსტრა"
                    onChange={(e) => setShelfOwner(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs text-ink-faint">
                QR-ში მხოლოდ თაროს კოდია — სკანერი მარტო თაროს ამოიკითხავს.
              </p>
              <p className="text-ink-soft">
                {items.length ? (
                  <>
                    {items.length} სტიკერი: <b>{items[0].code}</b>
                    {items.length > 1 && (
                      <>
                        {' '}
                        … <b>{items[items.length - 1].code}</b>
                      </>
                    )}
                  </>
                ) : (
                  'ჯერ ცარიელია.'
                )}
              </p>
            </>
          )}

          {tab === 'products' && (
            <>
              <div className="flex flex-wrap gap-2">
                {pill(prodSrc === 'excel', 'Excel-იდან', () => setProdSrc('excel'))}
                {pill(prodSrc === 'paste', 'ჩაკოპირებით', () => setProdSrc('paste'))}
              </div>
              {prodSrc === 'excel' ? (
                <>
                  <p className="text-xs text-ink-faint">
                    სვეტები: <b>შტრიხკოდი</b>, <b>დასახელება</b>, <b>რაოდენობა</b> (თუ ნაშთით
                    ბეჭდავ). შტრიხკოდის გარეშე პროდუქტს — მისი კოდი/არტიკული.
                  </p>
                  {fileInput((rows) => setProdRows(productsFromRows(rows)))}
                </>
              ) : (
                <textarea
                  rows={8}
                  className="rounded-xl border border-rule bg-paper p-3 font-mono text-sm outline-none focus:border-[#1f7a4d]"
                  value={prodText}
                  placeholder={
                    'შტრიხკოდი; დასახელება; კოდი; რაოდენობა\n4860103711939; ზეთი 1ლ; 10234; 12'
                  }
                  onChange={(e) => setProdText(e.target.value)}
                />
              )}
              {copiesBox(true)}
              <p className="text-ink-soft">
                სტიკერზე: შტრიხკოდი, ციფრები და დასახელება · {items.length} პროდუქტი
              </p>
            </>
          )}

          {tab === 'assets' && (
            <>
              <p className="text-xs text-ink-faint">
                ბუღალტერიის რეესტრი: <b>ბუღალტრული (საინვენტარო) კოდი</b> და <b>დასახელება</b>.
                სტიკერზე ნომერი და შტრიხკოდი ამ კოდიდანაა, ახალი არ იგონება. QR ხსნის საშუალების
                ბარათს ფოტოებით ({appUrl.replace(/^https?:\/\//, '')}/inv/ნომერი).
              </p>
              {fileInput((rows) => setAssetRows(rows))}
              {assetRows && (
                <>
                  <p className="text-ink-soft">
                    {items.length} სტიკერი ·{' '}
                    {noCode ? `${noCode} კოდის გარეშე (INV-…)` : 'ყველა ბუღალტრული კოდით'}
                  </p>
                  {noCode > 0 && (
                    <label className="grid gap-1">
                      <span className="text-xs text-ink-faint">
                        კოდის გარეშე საშუალებებს მიენიჭება Inverse-ის ნომერი (INV-…), დაწყება:
                      </span>
                      <input
                        type="number"
                        min={1}
                        className={`${field} w-28`}
                        value={invStart}
                        onChange={(e) => setInvStart(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </label>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'numbers' && (
            <>
              <label className="grid gap-1">
                <span className="text-xs text-ink-faint">წინსართი</span>
                <input
                  className={field}
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-ink-faint">დან</span>
                  <input
                    type="number"
                    min={0}
                    className={field}
                    value={from}
                    onChange={(e) => setFrom(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-ink-faint">მდე</span>
                  <input
                    type="number"
                    min={0}
                    className={field}
                    value={to}
                    onChange={(e) => setTo(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-ink-faint">ციფრი</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    className={field}
                    value={digits}
                    onChange={(e) =>
                      setDigits(Math.min(8, Math.max(1, Number(e.target.value) || 1)))
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-ink-faint">წარწერა (არასავალდებულო)</span>
                <input
                  className={field}
                  value={title}
                  placeholder="მაგ. ძირითადი საშუალება"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div className="flex gap-1">
                {(
                  [
                    ['qr', '▦ QR'],
                    ['barcode', '║ შტრიხკოდი'],
                    ['both', 'ორივე'],
                  ] as [LabelMode, string][]
                ).map(([m, l]) => pill(mode === m, l, () => setMode(m)))}
              </div>
              <p className="text-ink-soft">
                {count ? (
                  <>
                    {count} ეტიკეტი: <b>{items[0]?.code}</b> …{' '}
                    <b>{items[items.length - 1]?.code}</b>
                  </>
                ) : (
                  '„მდე“ უნდა იყოს „დან“-ზე მეტი.'
                )}
              </p>
            </>
          )}

          {tab === 'stocktake' && (
            <>
              <select
                className={field}
                value={st}
                onChange={(e) => setSt(e.target.value)}
                aria-label="ინვენტარიზაცია"
              >
                {stocktakes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {st && (
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['shelves', '▦ თაროები'],
                      ['products', '║ პროდუქცია'],
                      ['assets', '№ ინვენტარის ნომრები'],
                    ] as const
                  ).map(([k, l]) => (
                    <Link
                      key={k}
                      href={`/manage/labels?st=${st}&src=${k}`}
                      className={`rounded-full px-3 py-1.5 ${picked?.id === st && picked.src === k ? 'bg-ink text-paper' : 'border border-rule'}`}
                    >
                      {l}
                    </Link>
                  ))}
                </div>
              )}
              {picked && picked.id === st && picked.src !== 'products' && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Link
                    href={`/manage/labels?st=${st}&src=${picked.src}`}
                    className={`rounded-full px-3 py-1 ${!picked.all ? 'bg-ink text-paper' : 'border border-rule'}`}
                  >
                    {picked.src === 'assets' ? 'ეტიკეტი აკლია' : 'ამ ინვენტარიზაციის'}
                  </Link>
                  <Link
                    href={`/manage/labels?st=${st}&src=${picked.src}&all=1`}
                    className={`rounded-full px-3 py-1 ${picked.all ? 'bg-ink text-paper' : 'border border-rule'}`}
                  >
                    {picked.src === 'assets' ? 'მთელი რეესტრი' : 'ყველა თარო'}
                  </Link>
                </div>
              )}
              {picked && picked.id === st && picked.src === 'products' && copiesBox(true)}
              {picked && picked.id === st && (
                <p className="text-ink-soft">
                  {picked.note}: {picked.items.length} ეტიკეტი
                </p>
              )}
            </>
          )}

          {bad.length > 0 && (
            <p className="text-xs text-[#b45309]">
              {bad.length} კოდს ქართული ასო აქვს — შტრიხკოდად ვერ დაიბეჭდება, მხოლოდ ტექსტად (მაგ.{' '}
              {bad.slice(0, 3).join(', ')}). კოდი ლათინურით ჯობს.
            </p>
          )}
          {msg && <p className="text-xs text-[#b42318]">{msg}</p>}
        </section>

        <section className="rounded-2xl bg-paper-sunk p-5">
          {items.length > 0 ? (
            <ZebraPanel
              key={`${tab}-${mode}-${shelfSrc}-${prodSrc}-${picked?.src ?? ''}`}
              items={items}
              fileName={
                tab === 'numbers' ? `${prefix}${from}-${to}` : fileName ? `${tab}_${fileName}` : tab
              }
              kind={
                tab === 'shelves' ||
                (tab === 'numbers' && mode === 'qr') ||
                (tab === 'stocktake' && picked?.src === 'shelves')
                  ? 'shelves'
                  : 'products'
              }
            />
          ) : (
            <p className="text-sm text-ink-soft">
              {tab === 'stocktake'
                ? 'აირჩიე ინვენტარიზაცია და რა დაიბეჭდოს.'
                : 'დასაბეჭდი ეტიკეტი ჯერ არ არის.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
