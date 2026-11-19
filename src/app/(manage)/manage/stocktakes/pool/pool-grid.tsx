'use client';

import { useMemo } from 'react';
import type { ColDef } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';

export type PoolRow = {
  id: string;
  name: string;
  code: string;
  unit: string;
  shelf: string;
  book: number;
  counted: number | null;
  diff: number;
  price: number;
  sum: number;
  why: string;
};

const q = (v: number | null) =>
  v == null
    ? '—'
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false });
const money = (v: number) =>
  v ? v.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '';

export default function PoolGrid({
  rows,
  missed,
  fileName,
}: {
  rows: PoolRow[];
  missed: boolean;
  fileName: string;
}) {
  const columns = useMemo<ColDef<PoolRow>[]>(() => {
    const num: ColDef<PoolRow> = {
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      flex: 0.8,
      minWidth: 90,
    };
    const cols: ColDef<PoolRow>[] = [
      { headerName: 'ნომენკლატურა', field: 'name', flex: 3, minWidth: 220 },
      { headerName: 'ბარკოდი', field: 'code', flex: 1.2, minWidth: 120 },
      { headerName: 'ერთ.', field: 'unit', flex: 0.5, minWidth: 70 },
      { headerName: 'თარო (ნაშთით)', field: 'shelf', flex: 1, minWidth: 110 },
      { ...num, headerName: 'ნაშთი', field: 'book', valueFormatter: (p) => q(p.value) },
      ...(missed
        ? []
        : ([
            {
              ...num,
              headerName: 'დათვლილი',
              field: 'counted' as const,
              valueFormatter: (p: { value: number | null }) => q(p.value),
            },
          ] as ColDef<PoolRow>[])),
      {
        ...num,
        headerName: 'სხვაობა',
        field: 'diff',
        valueFormatter: (p) => q(p.value),
        cellClassRules: {
          'text-[#d64545] font-semibold': (p) => p.value < 0,
          'text-[#2563eb] font-semibold': (p) => p.value > 0,
        },
      },
      { ...num, headerName: 'ფასი', field: 'price', valueFormatter: (p) => money(p.value) },
      {
        ...num,
        headerName: 'თანხა ₾',
        field: 'sum',
        valueFormatter: (p) => money(p.value),
        cellClassRules: {
          'text-[#d64545]': (p) => p.value < 0,
          'text-[#2563eb]': (p) => p.value > 0,
        },
      },
      ...(missed
        ? []
        : ([
            { headerName: 'მიზეზი', field: 'why', flex: 1.4, minWidth: 140 },
          ] as ColDef<PoolRow>[])),
    ];
    return cols;
  }, [missed]);
  const totals = useMemo(() => {
    const t = { book: 0, diff: 0, sum: 0 };
    for (const r of rows) {
      t.book += r.book;
      t.diff += r.diff;
      t.sum += r.sum;
    }
    return [{ name: `სულ · ${rows.length} პოზიცია`, ...t } as Partial<PoolRow>];
  }, [rows]);
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      totals={totals}
      rowId={(r) => r.id}
      fileName={fileName}
      height={Math.min(680, 150 + rows.length * 40)}
    />
  );
}
