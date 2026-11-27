'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ActLine } from '@/lib/stock-act';
import LinesGrid, { type AiLine } from './lines-grid';

/** One shelf of the stocktake, as the manager's first level. */
export type ShelfRow = {
  locationId: string;
  code: string;
  counter: string;
  email: string;
  done: boolean;
  at: string;
  entries: number;
  qty: number;
  diffs: number;
  shots: number;
  note: string | null;
};

const q = (v: number) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false });

/**
 * The stocktake as shelves first: each shelf a row (who, when, how much,
 * differences, photo check), opened into its products. "სრული სია" shows the
 * whole stocktake's products at once, as before.
 */
export default function ShelvesView({
  id,
  shelves,
  lines,
  hasCost,
  fileName,
  ai,
}: {
  id: string;
  shelves: ShelfRow[];
  lines: ActLine[];
  hasCost: boolean;
  fileName: string;
  ai: Record<string, AiLine>;
}) {
  const [mode, setMode] = useState<'shelves' | 'all'>('shelves');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const byShelf = useMemo(() => {
    const m = new Map<string, ActLine[]>();
    const codeOf = new Map(shelves.map((s) => [s.code, s.locationId]));
    const none: ActLine[] = [];
    for (const l of lines) {
      const ids = new Set(
        l.shelves.map((s) => (s.code ? s.id : (codeOf.get(s.id) ?? s.id))).filter(Boolean),
      );
      if (!ids.size) none.push(l);
      for (const sid of ids) m.set(sid, [...(m.get(sid) ?? []), l]);
    }
    return { m, none };
  }, [lines, shelves]);

  const aiOf = (ls: ActLine[]) => {
    const v = ls
      .map((l) => (l.productId ? ai[l.productId] : undefined))
      .filter((x): x is AiLine => !!x);
    if (!v.length) return null;
    return {
      pct: Math.round((v.reduce((a, x) => a + x.confidence, 0) / v.length) * 100),
      ok: v.filter((x) => x.status === 'match').length,
      n: v.length,
    };
  };

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const tab = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-medium ${
      on ? 'border-[#1f7a4d] bg-[#1f7a4d] text-white' : 'border-rule-strong hover:bg-ink/5'
    }`;
  const totals = shelves.reduce(
    (t, s) => ({ entries: t.entries + s.entries, qty: t.qty + s.qty, diffs: t.diffs + s.diffs }),
    { entries: 0, qty: 0, diffs: 0 },
  );

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={tab(mode === 'shelves')}
          onClick={() => setMode('shelves')}
        >
          🗂 თაროებით ({shelves.length})
        </button>
        <button type="button" className={tab(mode === 'all')} onClick={() => setMode('all')}>
          📋 სრული სია ({lines.length} პოზიცია)
        </button>
        {mode === 'shelves' && shelves.length > 1 && (
          <button
            type="button"
            className="ml-auto text-xs text-ink-soft underline"
            onClick={() =>
              setOpen(open.size ? new Set() : new Set(shelves.map((s) => s.locationId)))
            }
          >
            {open.size ? 'ყველას დახურვა' : 'ყველას გახსნა'}
          </button>
        )}
      </div>

      {mode === 'all' ? (
        lines.length ? (
          <LinesGrid id={id} ai={ai} lines={lines} hasCost={hasCost} fileName={fileName} />
        ) : (
          <p className="text-sm text-ink-soft">ჯერ არაფერი დათვლილა.</p>
        )
      ) : (
        <div className="overflow-hidden rounded-control border border-rule/70">
          <div className="grid grid-cols-[1.5rem_5rem_1fr_7rem_4rem_5rem_4rem_4.5rem_3rem] gap-2 bg-paper-sunk px-3 py-2 text-xs text-ink-faint max-md:hidden">
            <span />
            <span>თარო</span>
            <span>თანამშრომელი</span>
            <span>სტატუსი</span>
            <span className="text-right">პოზ.</span>
            <span className="text-right">რაოდ.</span>
            <span className="text-right">სხვაობა</span>
            <span className="text-right">AI %</span>
            <span className="text-right">📷</span>
          </div>
          {shelves.map((s) => {
            const ls = byShelf.m.get(s.locationId) ?? [];
            const a = aiOf(ls);
            const isOpen = open.has(s.locationId);
            return (
              <div key={s.locationId} className="border-t border-rule/60">
                <button
                  type="button"
                  onClick={() => toggle(s.locationId)}
                  className="grid w-full grid-cols-[1.5rem_5rem_1fr_7rem_4rem_5rem_4rem_4.5rem_3rem] items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink/5 max-md:grid-cols-[1.5rem_5rem_1fr_4rem]"
                >
                  <span className="text-ink-faint">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold">{s.code}</span>
                  <span className="truncate" title={s.email}>
                    {s.counter || '—'}
                    {s.note && (
                      <span className="block truncate text-xs text-ink-soft">{s.note}</span>
                    )}
                  </span>
                  <span className={`max-md:hidden ${s.done ? 'text-match' : 'text-review'}`}>
                    {s.done ? `✓ ${s.at}` : 'ითვლება'}
                  </span>
                  <span className="text-right tabular-nums max-md:hidden">{ls.length}</span>
                  <span className="text-right tabular-nums">{q(s.qty)}</span>
                  <span
                    className={`text-right tabular-nums max-md:hidden ${s.diffs ? 'font-semibold text-mismatch' : 'text-ink-faint'}`}
                  >
                    {s.diffs}
                  </span>
                  <span
                    className="text-right tabular-nums max-md:hidden"
                    title={a ? `${a.ok} / ${a.n} ემთხვევა` : 'ფოტოებით არ შემოწმებულა'}
                  >
                    {a ? (
                      <span className={a.ok === a.n ? 'text-match' : 'text-review'}>{a.pct}%</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </span>
                  <span className="text-right text-ink-soft max-md:hidden">{s.shots || ''}</span>
                </button>
                {isOpen && (
                  <div className="grid gap-2 border-t border-rule/60 bg-paper-sunk/50 p-2">
                    <div className="flex flex-wrap gap-3 text-xs">
                      <Link
                        href={`/manage/${id}/shelf/${s.locationId}`}
                        className="font-semibold underline"
                      >
                        თაროს გვერდი: ფოტოები და AI შემოწმება →
                      </Link>
                      {ls.some((l) => l.shelves.length > 1) && (
                        <span className="text-ink-soft">
                          რამდენიმე თაროზე დათვლილ პროდუქტს მთელი აღწერის ჯამი უჩანს.
                        </span>
                      )}
                    </div>
                    {ls.length ? (
                      <LinesGrid
                        id={id}
                        ai={ai}
                        lines={ls}
                        hasCost={hasCost}
                        fileName={`${fileName}-${s.code}`}
                      />
                    ) : (
                      <p className="px-1 text-sm text-ink-soft">ამ თაროზე პროდუქტი არ ჩაწერილა.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {byShelf.none.length > 0 && (
            <div className="border-t border-rule/60">
              <button
                type="button"
                onClick={() => toggle('none')}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink/5"
              >
                <span className="w-4 text-ink-faint">{open.has('none') ? '▾' : '▸'}</span>
                <span className="font-semibold text-review">
                  თაროს გარეშე: {byShelf.none.length} პოზიცია (ნაშთში არის, არ დათვლილა)
                </span>
              </button>
              {open.has('none') && (
                <div className="border-t border-rule/60 p-2">
                  <LinesGrid
                    id={id}
                    ai={ai}
                    lines={byShelf.none}
                    hasCost={hasCost}
                    fileName={`${fileName}-no-shelf`}
                  />
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-[1.5rem_5rem_1fr_7rem_4rem_5rem_4rem_4.5rem_3rem] gap-2 border-t border-rule bg-paper-sunk px-3 py-2 text-sm font-semibold max-md:hidden">
            <span />
            <span>სულ</span>
            <span />
            <span />
            <span className="text-right tabular-nums">{lines.length}</span>
            <span className="text-right tabular-nums">{q(totals.qty)}</span>
            <span className="text-right tabular-nums">{totals.diffs}</span>
            <span />
            <span />
          </div>
        </div>
      )}
    </section>
  );
}
