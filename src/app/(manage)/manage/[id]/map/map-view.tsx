'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { inputClass } from '@/components/ui';
import { normKey } from '@/lib/text';
import { shelfKey, type FoundProduct } from '@/lib/shelf-finder';
import { findOnMap } from './actions';
import Map3D from './map-3d';

export type MapTile = {
  id: string;
  code: string;
  state: 'idle' | 'counting' | 'ok' | 'diff';
  who?: string;
  href?: string;
};
type State = MapTile['state'];

const STYLE: Record<State, string> = {
  idle: 'border-rule bg-paper-sunk text-ink-faint',
  counting: 'border-review bg-review/15 text-ink',
  ok: 'border-match bg-match/15 text-ink',
  diff: 'border-mismatch bg-mismatch/15 text-ink',
};
const LABEL: Record<State, string> = {
  idle: 'არ გახსნილა',
  counting: 'ითვლება',
  ok: 'დათვლილია, ემთხვევა',
  diff: 'სხვაობაა',
};

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/**
 * The rack a shelf belongs to, from its code: "1P-03-12" → "1P-03",
 * "A-01" / "A01" → "A". Codes with no letters and no separators go to "#".
 */
export const rowOf = (code: string) => {
  const parts = code
    .trim()
    .split(/[-\s._/\\]+/)
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, -1).join('-');
  return code.match(/^[^\d]+/)?.[0]?.trim() || '#';
};
const qty = (v: number) => Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 3 });

export default function MapView({
  stocktakeId,
  tiles: serverTiles,
  view3d,
  focus,
  focused,
  initialQuery,
}: {
  stocktakeId: string;
  tiles: MapTile[];
  view3d: boolean;
  focus: 'missed' | 'review' | null;
  focused: FoundProduct[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<FoundProduct[] | null>(null);
  // ?find= opens the map with a shelf code already looked up.
  const [asked, setAsked] = useState(initialQuery);
  const [picked, setTarget] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const gridRef = useRef<HTMLDivElement>(null);

  // Shelves a found product is on may be missing from the balance: add them grey.
  const tiles = useMemo(() => {
    const m = new Map(serverTiles.map((t) => [t.id, t]));
    for (const p of found ?? [])
      for (const s of p.shelves)
        if (!m.has(s.locationId))
          m.set(s.locationId, { id: s.locationId, code: s.code, state: 'idle' });
    return [...m.values()];
  }, [serverTiles, found]);

  // Shelves whose code matches what is typed (loosely: case, dashes, leading zeros).
  const shelfHits = useMemo(() => {
    const t = asked.trim();
    if (!t) return [];
    const k = shelfKey(t);
    const n = normKey(t);
    const exact = tiles.filter((x) => shelfKey(x.code) === k);
    if (exact.length) return exact;
    return tiles
      .filter((x) => normKey(x.code).includes(n) || shelfKey(x.code).includes(k))
      .sort((a, b) => natural(a.code, b.code))
      .slice(0, 30);
  }, [asked, tiles]);

  const lit = useMemo(() => {
    const s = new Set<string>();
    for (const t of shelfHits) s.add(t.id);
    for (const p of found ?? []) for (const x of p.shelves) s.add(x.locationId);
    if (!asked) for (const p of focused) for (const x of p.shelves) s.add(x.locationId);
    return s;
  }, [shelfHits, found, focused, asked]);

  // A shelf picked from the results; else one to three shelves matching the typed code.
  const target =
    picked ?? (shelfHits.length >= 1 && shelfHits.length <= 3 ? shelfHits[0]!.id : null);

  function search(raw: string) {
    const t = raw.trim();
    setAsked(t);
    setFound(null);
    setTarget(null);
    if (!t) return;
    start(async () => {
      const res = await findOnMap(stocktakeId, t).catch(() => []);
      setFound(res);
      const first = res.find((p) => p.shelves.length)?.shelves[0]?.locationId;
      if (first) setTarget((cur) => cur ?? first);
    });
  }
  // Grid: bring the target shelf on screen.
  useEffect(() => {
    if (!target || view3d) return;
    gridRef.current
      ?.querySelector(`[data-shelf="${target}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [target, view3d]);

  const rows = useMemo(() => {
    const m = new Map<string, MapTile[]>();
    for (const t of tiles) m.set(rowOf(t.code), [...(m.get(rowOf(t.code)) ?? []), t]);
    return [...m.entries()]
      .sort((a, b) => natural(a[0], b[0]))
      .map(([row, list]) => ({ row, tiles: [...list].sort((a, b) => natural(a.code, b.code)) }));
  }, [tiles]);
  const counts = (s: State) => tiles.filter((t) => t.state === s).length;
  const all = tiles.length;
  const codeOf = new Map(tiles.map((t) => [t.id, t.code]));

  const chip = (locId: string, label: string, extra = '') => (
    <button
      key={locId}
      type="button"
      onClick={() => setTarget(locId)}
      className={`rounded-md border-2 px-2 py-1 text-sm font-semibold tabular-nums ${
        target === locId ? 'border-[#f59e0b] bg-[#fef3c7] text-black' : 'border-rule-strong'
      } ${extra}`}
    >
      {label}
    </button>
  );

  // Focus list (missed / to re-check), grouped by shelf.
  const byShelf = useMemo(() => {
    const m = new Map<
      string,
      {
        code: string;
        items: { p: FoundProduct; book: number; counted: number; earlier?: string }[];
      }
    >();
    const none: FoundProduct[] = [];
    for (const p of focused) {
      if (!p.shelves.length) none.push(p);
      for (const s of p.shelves) {
        let g = m.get(s.locationId);
        if (!g) m.set(s.locationId, (g = { code: s.code, items: [] }));
        g.items.push({ p, book: s.book, counted: s.counted, earlier: s.earlier });
      }
    }
    return { shelves: [...m.entries()].sort((a, b) => natural(a[1].code, b[1].code)), none };
  }, [focused]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(['ok', 'diff', 'counting', 'idle'] as State[]).map((s) => (
          <div key={s} className={`rounded-control border-2 p-3 ${STYLE[s]}`}>
            <p className="text-2xl font-semibold">{counts(s)}</p>
            {LABEL[s]}
          </div>
        ))}
      </div>
      {all > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full bg-paper-sunk">
          <div className="bg-match" style={{ width: `${(counts('ok') / all) * 100}%` }} />
          <div className="bg-mismatch" style={{ width: `${(counts('diff') / all) * 100}%` }} />
          <div className="bg-review" style={{ width: `${(counts('counting') / all) * 100}%` }} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) search('');
          }}
          placeholder="🔎 თაროს კოდი, პროდუქტის სახელი ან შტრიხკოდი"
          className={`${inputClass} text-base`}
        />
        <button type="submit" className="rounded-control border border-rule-strong px-4">
          {pending ? '…' : 'ძებნა'}
        </button>
        {asked && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              search('');
            }}
            className="rounded-control border border-rule-strong px-3"
          >
            ✕
          </button>
        )}
      </form>

      {asked && (
        <div className="grid gap-3 rounded-control border border-rule p-3 text-sm">
          {shelfHits.length > 0 && (
            <div className="grid gap-1">
              <p className="text-ink-soft">თაროები:</p>
              <div className="flex flex-wrap gap-1.5">
                {shelfHits.map((t) => chip(t.id, t.code))}
              </div>
            </div>
          )}
          {found === null && pending && <p className="text-ink-faint">პროდუქტს ვეძებ…</p>}
          {found && found.length > 0 && (
            <ul className="grid gap-2">
              {found.map((p) => (
                <li key={p.id} className="grid gap-1">
                  <p>
                    <b>{p.name}</b> <span className="text-xs text-ink-faint">{p.code}</span>
                  </p>
                  {p.shelves.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.shelves.map((s) =>
                        chip(
                          s.locationId,
                          `${s.code} · ${s.counted ? `დათვ. ${qty(s.counted)}` : `ნაშთი ${qty(s.book)}`}${s.earlier ? ` (${s.earlier})` : ''}`,
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-faint">
                      თარო უცნობია — არც ნაშთში და არც დათვლაში თარო არ უწერია.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {found && found.length === 0 && !shelfHits.length && (
            <p className="text-ink-faint">ვერაფერი ვიპოვე.</p>
          )}
        </div>
      )}

      {all > 0 && view3d ? (
        <Map3D rows={rows} lit={[...lit]} target={target} />
      ) : all === 0 ? (
        <p className="text-sm text-ink-soft">
          ჯერ არცერთი თარო არ არის: ჩატვირთე ნაშთი თაროს სვეტით ან დაიწყე დათვლა.
        </p>
      ) : (
        <div ref={gridRef} className="grid gap-3">
          {rows.map(({ row, tiles: list }) => (
            <section key={row} className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
              <p className="pt-2 text-base font-semibold text-ink-soft break-all">{row}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((t) => {
                  const on = lit.has(t.id);
                  const tile = (
                    <span
                      data-shelf={t.id}
                      title={`${t.code} · ${LABEL[t.state]}${t.who ? ` · ${t.who}` : ''}`}
                      className={`grid min-w-14 place-items-center rounded-md border-2 px-2 py-2 text-sm font-semibold tabular-nums ${STYLE[t.state]} ${
                        on
                          ? `ring-4 ${target === t.id ? 'ring-[#f59e0b] animate-pulse' : 'ring-[#fbbf24]/70'}`
                          : lit.size
                            ? 'opacity-35'
                            : ''
                      }`}
                    >
                      {t.code}
                      {t.state === 'counting' && t.who && (
                        <span className="max-w-20 truncate text-[10px] font-normal">
                          {t.who.split(' ')[0]}
                        </span>
                      )}
                    </span>
                  );
                  return t.href ? (
                    <Link key={t.id} href={t.href}>
                      {tile}
                    </Link>
                  ) : (
                    <span key={t.id}>{tile}</span>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {focus && !asked && (
        <section className="grid gap-2 rounded-control border border-rule p-3 text-sm">
          <h2 className="text-base font-semibold">
            {focus === 'missed' ? 'გამორჩენილი' : 'გადასამოწმებელი'} — {focused.length} პროდუქტი,{' '}
            {byShelf.shelves.length} თაროზე
          </h2>
          <p className="text-xs text-ink-faint">
            თაროების მიხედვით, სიარულის რიგით. დააჭირე თაროს — რუკაზე გამოჩნდება.
          </p>
          <ul className="grid gap-2">
            {byShelf.shelves.map(([locId, g]) => (
              <li key={locId} className="grid gap-1 rounded-md border border-rule/70 p-2">
                <div>{chip(locId, codeOf.get(locId) ?? g.code)}</div>
                <ul className="grid gap-0.5 pl-1">
                  {g.items.map(({ p, book, counted, earlier }) => (
                    <li key={p.id} className="flex flex-wrap gap-x-2">
                      <span className="min-w-0 flex-1">{p.name}</span>
                      <span className="text-xs text-ink-faint tabular-nums">
                        {p.code} · ნაშთი {qty(book)} · დათვ. {qty(counted)} {p.unit ?? ''}
                        {earlier ? ` · ბოლოს ნანახი ${earlier}-ში` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {byShelf.none.length > 0 && (
            <details>
              <summary className="cursor-pointer">
                თარო უცნობია — {byShelf.none.length} პროდუქტი (ნაშთში თარო არ უწერია და არსად
                დათვლილა)
              </summary>
              <ul className="mt-1 grid gap-0.5">
                {byShelf.none.map((p) => (
                  <li key={p.id}>
                    {p.name} <span className="text-xs text-ink-faint">{p.code}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
