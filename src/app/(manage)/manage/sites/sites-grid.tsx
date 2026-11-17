'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import { mapsLink } from '@/lib/geo';
import DeleteSite from './delete-site';
import { editSite } from './actions';

export type SiteRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  model_url: string | null;
  /** Its latest stocktake: the 3D map opens on it (the whole warehouse). */
  map_id: string | null;
};

/** Change the name and address in place. */
function EditSite({ data, onDone }: { data: SiteRow; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await editSite(data.id, fd);
          if (r.error) setErr(r.error);
          else onDone();
        })
      }
      className="flex h-full w-full items-center gap-1"
    >
      <input
        name="name"
        defaultValue={data.name}
        autoFocus
        required
        className="min-w-0 flex-1 rounded-md border border-rule-strong bg-paper px-2 py-0.5 text-xs"
      />
      <input
        name="address"
        defaultValue={data.address ?? ''}
        placeholder="მისამართი"
        className="min-w-0 flex-[1.5] rounded-md border border-rule-strong bg-paper px-2 py-0.5 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#1f7a4d] px-2 py-0.5 text-xs font-semibold text-white"
      >
        {pending ? '…' : 'შენახვა'}
      </button>
      <button type="button" onClick={onDone} className="px-1 text-xs underline">
        გაუქმება
      </button>
      {err && (
        <span className="truncate text-xs text-mismatch" title={err}>
          {err}
        </span>
      )}
    </form>
  );
}

/** Warehouses and objects: the name opens its stocktakes; 3D map; edit; delete. */
export default function SitesGrid({ rows }: { rows: SiteRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const columns = useMemo<ColDef<SiteRow>[]>(
    () => [
      {
        headerName: 'საწყობი / ობიექტი',
        field: 'name',
        flex: 1,
        minWidth: 200,
        pinned: 'left',
        cellRenderer: (p: ICellRendererParams<SiteRow>) =>
          p.data && editing === p.data.id ? (
            <EditSite data={p.data} onDone={() => setEditing(null)} />
          ) : (
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
        colId: 'map3d',
        width: 140,
        sortable: false,
        filter: false,
        // The app's own map of this warehouse (every stocktake together).
        cellRenderer: (p: ICellRendererParams<SiteRow>) =>
          p.data?.map_id ? (
            <Link
              href={`/manage/${p.data.map_id}/map?view=3d`}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-[#155c39] hover:bg-[#e8f3ed]"
            >
              🏗 3D რუკა
            </Link>
          ) : (
            <span
              className="text-xs text-ink-faint"
              title="რუკა ჩნდება პირველი ინვენტარიზაციის შემდეგ"
            >
              ჯერ არ არის
            </span>
          ),
      },
      {
        headerName: 'მოქმედება',
        colId: 'actions',
        width: 240,
        sortable: false,
        filter: false,
        pinned: 'right',
        cellRenderer: (p: ICellRendererParams<SiteRow>) =>
          p.data ? (
            <span className="flex h-full items-center gap-1">
              <button
                type="button"
                onClick={() => setEditing(p.data!.id)}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-[#155c39] hover:bg-[#e8f3ed]"
              >
                ✎ რედაქტირება
              </button>
              <DeleteSite id={p.data.id} name={p.data.name} />
            </span>
          ) : null,
      },
    ],
    [editing],
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
