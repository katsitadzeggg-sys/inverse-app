'use client';

import { useMemo, useState } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import type { ActLine } from '@/lib/stock-act';
import { LinePhoto, ShelfMediaLinks } from './media-links';

type Row = Omit<ActLine, 'shelves'> & { shelf: string; diffSum: number | null };

const q = (v: number) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false });
const money = (v: number) =>
  v.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * The stocktake's lines in Balance's columns, as a working table: sort and
 * filter in every column, quick search, "differences only", totals pinned at
 * the bottom, the line's own photo, and the shelves' photos/videos underneath.
 */
export default function LinesGrid({
  id,
  lines,
  hasCost,
  fileName,
}: {
  id: string;
  lines: ActLine[];
  hasCost: boolean;
  fileName: string;
}) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const all = useMemo<Row[]>(
    () =>
      lines.map(({ shelves, ...l }) => ({
        ...l,
        shelf: shelves.map((s) => s.code).join(', '),
        diffSum: l.cost != null && l.diff ? l.diff * l.cost : null,
      })),
    [lines],
  );
  const rows = onlyDiff ? all.filter((r) => r.diff !== 0) : all;
  const totals = useMemo(() => {
    const t = { counted: 0, book: 0, diff: 0, diffSum: 0 };
    for (const r of rows) {
      t.counted += r.counted;
      t.book += r.book;
      t.diff += r.diff;
      t.diffSum += r.diffSum ?? 0;
    }
    return [{ name: `სულ · ${rows.length} პოზიცია`, ...t } as Partial<Row>];
  }, [rows]);
  const shelves = useMemo(() => {
    const seen = new Map<string, ActLine['shelves'][number]>();
    for (const l of lines) for (const sh of l.shelves) if (sh.media) seen.set(sh.id, sh);
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));
  }, [lines]);

  const columns = useMemo<ColDef<Row>[]>(() => {
    const num: ColDef<Row> = { type: 'numericColumn', filter: 'agNumberColumnFilter', width: 120 };
    const cols: ColDef<Row>[] = [
      { headerName: 'N', field: 'n', width: 70, filter: 'agNumberColumnFilter', pinned: 'left' },
      { headerName: 'სერიული ნომერი', field: 'sku', width: 150 },
      {
        headerName: 'ნომენკლატურა',
        field: 'name',
        minWidth: 240,
        flex: 2,
        pinned: 'left',
        cellClass: 'font-medium',
      },
      { headerName: 'ჯგუფი', field: 'group', width: 140 },
      { headerName: 'ბარკოდი', field: 'barcode', width: 150 },
      { headerName: 'ერთ.', field: 'unit', width: 80 },
      { headerName: 'თარო', field: 'shelf', width: 110 },
      ...((hasCost
        ? [
            {
              ...num,
              headerName: 'ფასი',
              field: 'cost' as const,
              valueFormatter: (p: { value: number | null }) =>
                p.value != null ? money(p.value) : '',
            },
          ]
        : []) as ColDef<Row>[]),
      {
        ...num,
        headerName: 'ფაქტ. რაოდ.',
        field: 'counted',
        cellClass: 'font-semibold',
        valueFormatter: (p) => q(p.value),
      },
      {
        ...num,
        headerName: 'ბუღალტრული ნაშთი',
        field: 'book',
        width: 150,
        valueFormatter: (p) => q(p.value),
      },
      {
        ...num,
        headerName: 'სხვაობა',
        field: 'diff',
        valueFormatter: (p) => q(p.value),
        cellClassRules: {
          'text-[#d64545] font-semibold': (p) => p.value < 0,
          'text-[#2563eb] font-semibold': (p) => p.value > 0,
          'text-[#a0aec0]': (p) => p.value === 0,
        },
      },
      ...((hasCost
        ? [
            {
              ...num,
              headerName: 'სხვაობის თანხა',
              field: 'diffSum' as const,
              width: 140,
              valueFormatter: (p: { value: number | null }) => (p.value ? money(p.value) : ''),
              cellClassRules: {
                'text-[#d64545]': (p: { value: number | null }) => (p.value ?? 0) < 0,
                'text-[#2563eb]': (p: { value: number | null }) => (p.value ?? 0) > 0,
              },
            },
          ]
        : []) as ColDef<Row>[]),
      {
        headerName: 'ფოტო',
        field: 'photo',
        width: 80,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data?.photo ? <LinePhoto url={p.data.photo} name={p.data.name} /> : null,
      },
      { headerName: 'კომენტარი', field: 'comment', width: 160 },
    ];
    return cols;
  }, [hasCost]);

  return (
    <div className="grid gap-2">
      <DataGrid
        rows={rows}
        columns={columns}
        totals={totals}
        rowId={(r) => String(r.n)}
        fileName={fileName}
        height={Math.min(640, 150 + rows.length * 40)}
        toolbar={
          <button
            type="button"
            onClick={() => setOnlyDiff((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              onlyDiff
                ? 'border-[#1f7a4d] bg-[#1f7a4d] text-white'
                : 'border-rule-strong hover:bg-ink/5'
            }`}
          >
            მხოლოდ სხვაობები ({all.filter((r) => r.diff !== 0).length})
          </button>
        }
      />
      {shelves.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
          <span className="text-ink-soft">თაროების ფოტო/ვიდეო:</span>
          <ShelfMediaLinks stocktakeId={id} shelves={shelves} />
        </p>
      )}
    </div>
  );
}
