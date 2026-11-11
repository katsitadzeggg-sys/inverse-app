'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import { mapsLink } from '@/lib/geo';
import DeleteSite from './delete-site';
import { setSiteModel } from './actions';

export type SiteRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  model_url: string | null;
};

/** The 3D warehouse: open it, or type its link in place. */
function Model({ data }: ICellRendererParams<SiteRow>) {
  const [edit, setEdit] = useState(false);
  if (!data) return null;
  if (edit)
    return (
      <form
        action={setSiteModel.bind(null, data.id)}
        onSubmit={() => setEdit(false)}
        className="flex w-full gap-1"
      >
        <input
          name="model_url"
          type="url"
          autoFocus
          defaultValue={data.model_url ?? ''}
          placeholder="https://…"
          className="min-w-0 flex-1 rounded-md border border-rule-strong px-2 py-0.5 text-xs"
        />
        <button type="submit" className="rounded-md border border-rule-strong px-2 text-xs">
          ✓
        </button>
      </form>
    );
  return (
    <span className="flex items-center gap-2 text-xs">
      {data.model_url && (
        <a
          href={data.model_url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[#155c39]"
        >
          🏗 3D
        </a>
      )}
      <button type="button" onClick={() => setEdit(true)} className="text-ink-faint underline">
        {data.model_url ? 'შეცვლა' : 'ბმული'}
      </button>
    </span>
  );
}

/** Warehouses and objects: the name opens its stocktakes; 3D link; delete. */
export default function SitesGrid({ rows }: { rows: SiteRow[] }) {
  const columns = useMemo<ColDef<SiteRow>[]>(
    () => [
      {
        headerName: 'საწყობი / ობიექტი',
        field: 'name',
        flex: 1,
        minWidth: 200,
        pinned: 'left',
        cellRenderer: (p: ICellRendererParams<SiteRow>) => (
          <Link
            href={`/manage/stocktakes?kind=all&q=${encodeURIComponent(p.value)}`}
            className="font-semibold text-[#155c39] hover:underline"
          >
            {p.value} →
          </Link>
        ),
      },
      { headerName: 'მისამართი', field: 'address', flex: 1.5, minWidth: 220 },
      {
        headerName: 'რუკა',
        colId: 'map',
        width: 90,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<SiteRow>) =>
          p.data?.lat != null && p.data?.lng != null ? (
            <a
              href={mapsLink(p.data.lat, p.data.lng)}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline"
            >
              📍 რუკა
            </a>
          ) : null,
      },
      {
        headerName: '3D საწყობი',
        field: 'model_url',
        width: 230,
        filter: false,
        cellRenderer: Model,
      },
      {
        headerName: '',
        colId: 'actions',
        width: 110,
        sortable: false,
        filter: false,
        pinned: 'right',
        cellRenderer: (p: ICellRendererParams<SiteRow>) =>
          p.data ? <DeleteSite id={p.data.id} /> : null,
      },
    ],
    [],
  );
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowId={(r) => r.id}
      fileName="obieqtebi"
      height={Math.min(640, 150 + rows.length * 40)}
    />
  );
}
