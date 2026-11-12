'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import { openPoolForm } from './actions';

export type StRow = {
  id: string;
  kind: string;
  number: string;
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

/** "Open the form" on a pinned row: made once, then the same one opens. */
function FormButton({ ids, kind }: { ids: string[]; kind: 'missed' | 'review' }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex h-full items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await openPoolForm(ids, kind);
            if (r?.error) setErr(r.error);
          })
        }
        className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${kind === 'missed' ? 'text-[#5b21b6] hover:bg-[#ece5ff]' : 'text-[#b45309] hover:bg-[#ffe8cc]'}`}
      >
        {pending ? 'იხსნება…' : '📋 ფორმის გახსნა'}
      </button>
      {err && <span className="text-xs text-[#d64545]">{err}</span>}
    </span>
  );
}

const KIND: Record<string, string> = { stock: '📦', expiry: '⏳', assets: '🏷' };
const n = (v: number) => Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 2 });
const gel = (v: number) => `${Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 0 })} ₾`;
const fmt = (t: string, o: Intl.DateTimeFormatOptions) =>
  new Date(t).toLocaleString('ka-GE', { ...o, timeZone: 'Asia/Tbilisi' });
const dayOf = (t: string) => fmt(t, { day: '2-digit', month: '2-digit', year: '2-digit' });
const hm = (t: string) => fmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "11.11.26 10:05 → 14:20" (closing day too when it is another day). */
const span = (a: string, b: string | null) =>
  `${dayOf(a)} ${hm(a)}${b ? ` → ${dayOf(b) === dayOf(a) ? hm(b) : `${dayOf(b)} ${hm(b)}`}` : ''}`;

function Actions({ data }: ICellRendererParams<StRow>) {
  if (!data) return null;
  if (data.left || data.review)
    return data.ids?.length ? (
      <FormButton ids={data.ids} kind={data.left ? 'missed' : 'review'} />
    ) : null;
  const a = 'rounded-full px-2.5 py-1 text-xs font-medium hover:bg-[#e8f3ed]';
  return (
    <span className="flex h-full items-center gap-1">
      <Link href={`/manage/${data.id}`} className={`${a} text-[#155c39]`}>
        გახსნა
      </Link>
      {data.kind !== 'assets' && (
        <Link href={`/manage/${data.id}/act`} className={`${a} text-[#155c39]`}>
          აქტი
        </Link>
      )}
      {data.kind !== 'assets' && (
        <a href={`/manage/${data.id}/act/xlsx`} className={`${a} text-[#155c39]`}>
          Excel
        </a>
      )}
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
        width: 48,
        minWidth: 48,
        pinned: 'left',
        valueFormatter: (p) =>
          p.data?.review ? '🔎' : p.data?.left ? '⏳' : (KIND[p.value] ?? ''),
        filter: false,
      },
      {
        headerName: 'ინვენტარიზაციის N',
        field: 'number',
        width: 140,
        pinned: 'left',
        cellRenderer: (p: ICellRendererParams<StRow>) =>
          p.data?.review ? (
            <b
              className="text-[#b45309]"
              title={`ნაშთიდან გაქრა დაუთვლელი: ${p.data.zeroed ?? 0} · დათვლის დღეს ბრუნვა ჰქონდა: ${p.data.moved ?? 0}`}
            >
              გადასამოწმებელი
            </b>
          ) : p.data?.left ? (
            <b className="text-[#5b21b6]">გამორჩენილი</b>
          ) : (
            <Link
              href={`/manage/${p.data?.id}`}
              className="font-medium text-[#155c39] hover:underline"
            >
              {p.value}
              {p.data?.formKind === 'missed' && (
                <span className="ml-1 rounded-full bg-[#ece5ff] px-1.5 text-[10px] text-[#5b21b6]">
                  გამორჩენილი
                </span>
              )}
              {p.data?.formKind === 'review' && (
                <span className="ml-1 rounded-full bg-[#ffe8cc] px-1.5 text-[10px] text-[#b45309]">
                  გადამოწმება
                </span>
              )}
            </Link>
          ),
      },
      {
        headerName: 'გაიხსნა → დაიხურა',
        field: 'opened',
        width: 175,
        filter: 'agDateColumnFilter',
        valueFormatter: (p) =>
          p.data && !p.data.left && !p.data.review ? span(p.data.opened, p.data.closed) : '',
        filterParams: {
          comparator: (d: Date, v: string) => {
            const t = new Date(v);
            const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
            return a < d.getTime() ? -1 : a > d.getTime() ? 1 : 0;
          },
        },
      },
      {
        headerName: 'საწყობი',
        field: 'warehouse',
        flex: 1,
        minWidth: 140,
        cellClass: 'font-semibold',
      },
      {
        headerName: 'თარო',
        field: 'shelves',
        width: 80,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        valueFormatter: (p) => (p.data?.left || p.data?.review ? '—' : String(p.value)),
        tooltipValueGetter: (p) =>
          p.data?.left || p.data?.review ? undefined : `დასრულებული ${p.data?.shelvesDone ?? 0} / ${p.value}`,
      },
      {
        headerName: 'SKU',
        field: 'skus',
        width: 75,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'პროდუქტი',
        field: 'counted',
        width: 100,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        valueFormatter: (p) => (p.data?.review ? '—' : n(p.value)),
      },
      {
        headerName: 'მეტობა ₾',
        field: 'plusSum',
        width: 115,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        cellClass: 'text-[#2563eb]',
        valueFormatter: (p) =>
          p.data?.plusQty
            ? `+${n(p.data.plusQty)} / ${gel(p.value)}${p.data.plusNocost ? ' *' : ''}`
            : '—',
        tooltipValueGetter: (p) =>
          p.data?.plusNocost
            ? `${p.data.plusNocost} პროდუქტს ფასი არ აქვს — თანხაში არ ითვლება`
            : undefined,
      },
      {
        headerName: 'დანაკლისი ₾',
        field: 'minusSum',
        width: 135,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        cellClass: 'text-[#d64545]',
        valueFormatter: (p) =>
          p.data?.minusQty ? `−${n(p.data.minusQty)} / ${gel(p.value)}` : '—',
      },
      {
        headerName: 'სხვაობა ₾',
        field: 'diffSum',
        width: 115,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        cellClassRules: {
          'text-[#d64545] font-semibold': (p) => !p.data?.left && !p.data?.review && p.value < 0,
          'text-[#2563eb] font-semibold': (p) => !p.data?.left && !p.data?.review && p.value > 0,
          'text-[#5b21b6] font-semibold': (p) => !!p.data?.left,
          'text-[#b45309] font-semibold': (p) => !!p.data?.review,
        },
        valueFormatter: (p) =>
          p.data?.left ? gel(p.value) : p.data?.plusQty || p.data?.minusQty ? gel(p.value) : '—',
      },
      {
        headerName: 'სტატუსი',
        field: 'status',
        width: 105,
        cellRenderer: (p: ICellRendererParams<StRow>) =>
          p.data?.left ? (
            <span className="text-xs text-[#5b21b6]">ფორმა დასათვლელად</span>
          ) : p.data?.review ? (
            <span className="text-xs text-[#b45309]">შესამოწმებელი</span>
          ) : p.value === 'open' ? (
            <span className="rounded-full bg-[#fdf3dc] px-2 py-0.5 text-xs font-medium text-[#8a5a00]">
              მიმდინარე
            </span>
          ) : (
            <span className="rounded-full bg-[#e3f4ea] px-2 py-0.5 text-xs font-medium text-[#155c39]">
              დახურული
            </span>
          ),
        filterValueGetter: (p) => (p.data?.status === 'open' ? 'მიმდინარე' : 'დახურული'),
      },
      {
        headerName: 'მოქმედება',
        colId: 'actions',
        width: 190,
        sortable: false,
        cellStyle: { display: 'flex', alignItems: 'center' },
        filter: false,
        pinned: 'right',
        cellRenderer: Actions,
      },
    ],
    [],
  );
  return (
    <DataGrid
      rows={rows}
      pinnedTop={left}
      columns={columns}
      rowId={(r) => r.id}
      fileName="inventarizaciebi"
      height={Math.min(720, 140 + (rows.length + left.length) * 40)}
      rowClass={(p) =>
        p.data?.left ? 'st-left-row' : p.data?.review ? 'st-review-row' : undefined
      }
    />
  );
}
