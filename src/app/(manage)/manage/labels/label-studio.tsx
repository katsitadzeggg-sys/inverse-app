'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { LabelData, LabelMode } from '@/lib/zebra';
import ZebraPanel from '@/app/(count)/count/[id]/labels/zebra-panel';

type Tab = 'numbers' | 'list' | 'shelves' | 'stocktake';

const field =
  'h-10 rounded-xl border border-rule bg-paper px-3 text-sm outline-none focus:border-[#1f7a4d]';

/**
 * The label studio: pick what to print, see it, print it all at once.
 * Numbered: prefix + a range with leading zeros (A-001 … A-200), as QR,
 * barcode or both. List: one code per line, "code; name" for a caption.
 */
export default function LabelStudio({
  owner,
  shelves,
  stocktakes,
}: {
  owner: string;
  shelves: { code: string; name: string }[];
  stocktakes: { id: string; label: string }[];
}) {
  const [tab, setTab] = useState<Tab>('numbers');
  const [prefix, setPrefix] = useState('A-');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(50);
  const [digits, setDigits] = useState(3);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<LabelMode>('qr');
  const [text, setText] = useState('');
  const [listMode, setListMode] = useState<LabelMode>('barcode');
  const [st, setSt] = useState(stocktakes[0]?.id ?? '');

  const count = Math.max(0, Math.min(5000, to - from + 1));
  const items: LabelData[] = useMemo(() => {
    if (tab === 'numbers')
      return Array.from({ length: count }, (_, i) => ({
        code: `${prefix}${String(from + i).padStart(digits, '0')}`,
        title,
        footer: owner,
        mode,
      }));
    if (tab === 'list')
      return text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [code, ...rest] = l.split(/[;\t]/);
          return { code: code.trim(), title: rest.join(' ').trim(), mode: listMode };
        })
        .filter((d) => d.code);
    if (tab === 'shelves')
      return shelves.map((s) => ({
        code: s.code,
        title: s.name && s.name !== s.code ? s.name : 'თარო',
        footer: owner,
        mode: 'qr' as const,
      }));
    return [];
  }, [tab, count, prefix, from, digits, title, owner, mode, text, listMode, shelves]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t ? 'bg-[#1f7a4d] text-white' : 'border border-rule-strong hover:bg-paper-sunk'}`}
    >
      {label}
    </button>
  );
  const modeBtns = (v: LabelMode, set: (m: LabelMode) => void) => (
    <div className="flex gap-1">
      {(
        [
          ['qr', '▦ QR'],
          ['barcode', '║ შტრიხკოდი'],
          ['both', 'ორივე'],
        ] as [LabelMode, string][]
      ).map(([m, l]) => (
        <button
          key={m}
          type="button"
          onClick={() => set(m)}
          className={`rounded-full px-3 py-1.5 text-sm ${v === m ? 'bg-ink text-paper' : 'border border-rule'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-paper-sunk px-5 py-4">
        <h1 className="mr-3 text-2xl font-semibold">🏷 ეტიკეტები</h1>
        {tabBtn('numbers', '№ დანომრილი')}
        {tabBtn('list', '║ სიიდან')}
        {tabBtn('shelves', `▦ თაროები (${shelves.length})`)}
        {tabBtn('stocktake', '📦 ინვენტარიზაციიდან')}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[22rem_1fr]">
        <section className="grid gap-3 rounded-2xl bg-paper-sunk p-5 text-sm">
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
              {modeBtns(mode, setMode)}
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
          {tab === 'list' && (
            <>
              <p className="text-xs text-ink-faint">
                ერთი კოდი ერთ ხაზზე. წარწერისთვის: <code>კოდი; დასახელება</code>. Excel-იდან ორი
                სვეტის ჩაკოპირებაც მუშაობს.
              </p>
              <textarea
                rows={12}
                className="rounded-xl border border-rule bg-paper p-3 font-mono text-sm outline-none focus:border-[#1f7a4d]"
                value={text}
                placeholder={'4860103711939; ზეთი 1ლ\n2009998832196'}
                onChange={(e) => setText(e.target.value)}
              />
              {modeBtns(listMode, setListMode)}
              <p className="text-ink-soft">{items.length} ეტიკეტი</p>
            </>
          )}
          {tab === 'shelves' && (
            <p className="text-ink-soft">
              კომპანიის ყველა თაროს QR — {shelves.length} ეტიკეტი. ფილტრით შეგიძლია ნაწილი აირჩიო.
            </p>
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
                <div className="grid gap-2">
                  <Link href={`/count/${st}/labels?src=shelves`} className="underline">
                    ▦ ამ ინვენტარიზაციის თაროები
                  </Link>
                  <Link href={`/count/${st}/labels?src=products`} className="underline">
                    ║ პროდუქციის შტრიხკოდები
                  </Link>
                  <Link href={`/count/${st}/labels?src=assets`} className="underline">
                    № ინვენტარის ნომრები (ძირ. საშ.)
                  </Link>
                </div>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl bg-paper-sunk p-5">
          {items.length > 0 ? (
            <ZebraPanel
              key={`${tab}-${mode}-${listMode}`}
              items={items}
              fileName={tab === 'numbers' ? `${prefix}${from}-${to}` : tab}
              kind={
                tab === 'shelves' || (tab === 'numbers' && mode === 'qr') ? 'shelves' : 'products'
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
