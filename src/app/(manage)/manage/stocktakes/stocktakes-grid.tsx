'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';

export type StRow = {
  id: string;
  kind: string;
  number: string;
  /** The cycle's name and code ("C4", shown beside the number). */
  cycle?: string;
  cycleCode?: string;
  /** Photo check: products checked, matched, mean match probability (%). */
  ai?: { checked: number; matched: number; pct: number };
  opened: string;
  closed: string | null;
  warehouse: string;
  shelves: number;
  shelvesDone: number;
  skus: number;
  counted: number;
  plusQty: number;
  plusSum: number;
  plusNocost: number;
  minusQty: number;
  minusSum: number;
  diffSum: number;
  status: 'open' | 'closed';
  /** The pinned "still to count" row (დარჩენილი). */
  left?: boolean;
  /** The pinned "to re-check" row (გადასამოწმებელი): differences of all stocktakes. */
  review?: boolean;
  /** Stocktakes behind a pinned row (one warehouse). */
  ids?: string[];
  /** 'missed' / 'review': a form made from the pinned rows. */
  formKind?: string | null;
  /** On the review row: why — gone from the balance uncounted / moved on the count day. */
  zeroed?: number;
  moved?: number;
};

const KIND: Record<string, string> = { stock: '📦', expiry: '⏳', assets: '🏷' };
const KIND_NAME: Record<string, string> = {
  stock: 'მარაგები',
  expiry: 'ვადიანი პროდუქცია',
  assets: 'ძირითადი საშუალებები',
};
const n = (v: number) => Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 2 });
const gel = (v: number) => `${Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 0 })} ₾`;
const fmt = (t: string, o: Intl.DateTimeFormatOptions) =>
  new Date(t).toLocaleString('ka-GE', { ...o, timeZone: 'Asia/Tbilisi' });
const dayOf = (t: string) => fmt(t, { day: '2-digit', month: '2-digit', year: '2-digit' });
const hm = (t: string) => fmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function Actions({ data }: ICellRendererParams<StRow>) {
  if (!data) return null;
  if (data.left || data.review)
    return data.ids?.length ? (
      <Link
        href={`/manage/${data.ids[0]}/map?view=3d&focus=${data.left ? 'missed' : 'review'}`}
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${data.left ? 'text-[#5b21b6] hover:bg-[#ece5ff]' : 'text-[#b45309] hover:bg-[#ffe8cc]'}`}
      >
        🗺 რუკაზე
      </Link>
    ) : null;
  if (data.kind === 'assets') return null;
  const a = 'rounded-full px-2.5 py-1 text-xs font-medium text-[#155c39] hover:bg-[#e8f3ed]';
  return (
    <span className="flex items-center gap-0.5 whitespace-nowrap">
      <Link href={`/manage/${data.id}/act`} className={a}>
        აქტი
      </Link>
      <a href={`/manage/${data.id}/act/xlsx`} className={a}>
        Excel
      </a>
    </span>
  );
}

/** Two lines in one cell: the main value, and a smaller one under it. */
function Two({
  top,
  sub,
  className = '',
}: {
  top: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 flex-col justify-center leading-tight ${className}`}>
      <span className="truncate">{top}</span>
      {sub != null && sub !== '' && <span className="truncate text-xs text-ink-faint">{sub}</span>}
    </span>
  );
}

/** All stocktakes of the filter in one sortable, filterable table. */
export default function StocktakesGrid({ rows, left }: { rows: StRow[]; left: StRow[] }) {
  const columns = useMemo<ColDef<StRow>[]>(
    () => [
      {
        headerName: '',
        field: 'kind',
        width: 36,
        minWidth: 36,
        valueFormatter: (p) =>
          p.data?.review ? '🔎' : p.data?.left ? '⏳' : (KIND[p.value] ?? ''),
        tooltipValueGetter: (p) =>
          p.data?.review
            ? 'გადასამოწმებელი: დათვლილი, მაგრამ ჯამი ნაშთს არ ემთხვევა'
            : p.data?.left
              ? 'გამორჩენილი: ნაშთშია, მაგრამ არცერთ ინვენტარიზაციაში არ დაითვალა'
              : KIND_NAME[p.value as string],
        headerTooltip: '📦 მარაგები · ⏳ ვადიანი · 🏷 ძირ. საშუალებები',
        filter: false,
      },
      {
        // Number (and cycle code) over the warehouse and cycle.
        headerName: 'ინვენტარიზაცია / საწყობი',
        field: 'number',
        flex: 1.8,
        minWidth: 170,
        filterValueGetter: (p) => `${p.data?.number ?? ''} ${p.data?.warehouse ?? ''}`,
        getQuickFilterText: (p) =>
          `${p.data?.number ?? ''} ${p.data?.warehouse ?? ''} ${p.data?.cycle ?? ''}`,
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const d = p.data;
          if (!d) return null;
          if (d.left || d.review)
            return (
              <Two
                className={d.left ? 'text-[#5b21b6]' : 'text-[#b45309]'}
                top={<b>{d.left ? 'გამორჩენილი' : 'გადასამოწმებელი'}</b>}
                sub={d.warehouse}
              />
            );
          return (
            <Two
              top={
                <span className="font-medium text-[#155c39]">
                  {d.number}
                  {d.cycleCode && (
                    <span className="ml-1 text-xs font-normal text-ink-faint">· {d.cycleCode}</span>
                  )}
                  {d.formKind === 'missed' && (
                    <span className="ml-1 rounded-full bg-[#ece5ff] px-1.5 text-[10px] text-[#5b21b6]">
                      გამორჩენილი
                    </span>
                  )}
                  {d.formKind === 'review' && (
                    <span className="ml-1 rounded-full bg-[#ffe8cc] px-1.5 text-[10px] text-[#b45309]">
                      გადამოწმება
                    </span>
                  )}
                </span>
              }
              sub={
                <>
                  <b className="text-ink">{d.warehouse}</b>
                  {d.cycle && <span> · {d.cycle}</span>}
                </>
              }
            />
          );
        },
      },
      {
        headerName: 'გაიხსნა / დაიხურა',
        field: 'opened',
        flex: 1,
        minWidth: 110,
        filter: 'agDateColumnFilter',
        filterParams: {
          comparator: (d: Date, v: string) => {
            const t = new Date(v);
            const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
            return a < d.getTime() ? -1 : a > d.getTime() ? 1 : 0;
          },
        },
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const d = p.data;
          if (!d || d.left || d.review) return null;
          return (
            <Two
              className="tabular-nums"
              top={`${dayOf(d.opened)} ${hm(d.opened)}`}
              sub={
                d.closed
                  ? `→ ${dayOf(d.closed) === dayOf(d.opened) ? hm(d.closed) : `${dayOf(d.closed)} ${hm(d.closed)}`}`
                  : 'მიმდინარე'
              }
            />
          );
        },
      },
      {
        // Shelves · SKU over units counted.
        headerName: 'თარო · SKU / ერთ.',
        field: 'skus',
        flex: 0.9,
        minWidth: 105,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <Two
              className="items-end tabular-nums"
              top={d.left || d.review ? `${n(d.skus)} SKU` : `${d.shelves} თარო · ${d.skus} SKU`}
              sub={d.review ? '' : `${n(d.counted)} ერთ.`}
            />
          );
        },
        tooltipValueGetter: (p) =>
          p.data?.left || p.data?.review
            ? undefined
            : `დასრულებული თარო ${p.data?.shelvesDone ?? 0} / ${p.data?.shelves ?? 0}`,
      },
      {
        // Surplus over shortage, quantity / money.
        headerName: 'მეტობა / დანაკლისი',
        field: 'plusSum',
        flex: 1.1,
        minWidth: 120,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        comparator: (a, b, x, y) => a - b || (x.data?.plusQty ?? 0) - (y.data?.plusQty ?? 0),
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const d = p.data;
          if (!d || d.left) return <span className="text-ink-faint">—</span>;
          return (
            <span className="flex flex-col items-end justify-center leading-tight tabular-nums">
              <span
                className="text-[#2563eb]"
                title={
                  d.plusNocost
                    ? `${d.plusNocost} პროდუქტს ფასი არ აქვს — თანხაში არ ითვლება`
                    : undefined
                }
              >
                {d.plusQty
                  ? `+${n(d.plusQty)} / ${gel(d.plusSum)}${d.plusNocost ? ' *' : ''}`
                  : '+0'}
              </span>
              <span className="text-[#d64545]">
                {d.minusQty ? `−${n(d.minusQty)} / ${gel(d.minusSum)}` : '−0'}
              </span>
            </span>
          );
        },
      },
      {
        headerName: 'სხვაობა ₾',
        field: 'diffSum',
        flex: 0.8,
        minWidth: 95,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const d = p.data;
          if (!d) return null;
          const tone = d.left
            ? 'text-[#5b21b6]'
            : d.review
              ? 'text-[#b45309]'
              : d.diffSum < 0
                ? 'text-[#d64545]'
                : d.diffSum > 0
                  ? 'text-[#2563eb]'
                  : 'text-ink-faint';
          const v = d.left || d.plusQty || d.minusQty ? gel(d.diffSum) : '—';
          return (
            <span className="flex flex-col items-end justify-center leading-tight">
              <b className={`tabular-nums ${tone}`}>{v}</b>
              {!d.left && !d.review && (
                <span
                  className={`text-[11px] ${d.status === 'open' ? 'text-[#8a5a00]' : 'text-[#155c39]'}`}
                >
                  {d.status === 'open' ? 'მიმდინარე' : 'დახურული'}
                </span>
              )}
            </span>
          );
        },
      },
      {
        headerName: 'AI %',
        colId: 'ai',
        headerTooltip: 'ფოტოებით შემოწმება: დამთხვევის საშუალო ალბათობა · ემთხვევა / შემოწმდა',
        flex: 0.6,
        minWidth: 75,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        valueGetter: (p) => p.data?.ai?.pct ?? null,
        cellRenderer: (p: ICellRendererParams<StRow>) => {
          const a = p.data?.ai;
          if (!a) return <span className="text-ink-faint">—</span>;
          return (
            <Two
              className={`items-end font-semibold ${a.matched === a.checked ? 'text-match' : 'text-review'}`}
              top={`${a.pct}%`}
              sub={`${a.matched}/${a.checked}`}
            />
          );
        },
      },
      {
        headerName: '',
        colId: 'actions',
        flex: 0.8,
        minWidth: 115,
        sortable: false,
        filter: false,
        cellRenderer: Actions,
      },
    ],
    [],
  );
  return (
    <DataGrid
      toolbar={
        <>
          <span className="hidden text-xs text-ink-faint lg:inline">
            📦 მარაგები · ⏳ ვადიანი · 🏷 ძირ. საშ. ·{' '}
            <span className="text-[#5b21b6]">⏳ გამორჩენილი</span> ·{' '}
            <span className="text-[#b45309]">🔎 გადასამოწმებელი</span>
          </span>
        </>
      }
      rows={rows}
      pinnedTop={left}
      columns={columns}
      rowId={(r) => r.id}
      fileName="inventarizaciebi"
      height={Math.min(720, 140 + (rows.length + left.length) * 40)}
      rowClass={(p) =>
        p.data?.left ? 'st-left-row' : p.data?.review ? 'st-review-row' : undefined
      }
      rowHeight={52}
      rowHref={(r) =>
        r.left || r.review
          ? r.ids?.length
            ? `/manage/stocktakes/pool?kind=${r.left ? 'missed' : 'review'}&ids=${r.ids.join(',')}`
            : null
          : r.id
            ? `/manage/${r.id}`
            : null
      }
    />
  );
}
