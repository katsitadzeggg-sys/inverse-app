'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import { mapsLink } from '@/lib/geo';
import DeleteSite from './delete-site';
import { editSite } from './actions';
import MapPicker from '@/components/map-picker';
import { Alert, Button, inputClass } from '@/components/ui';

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

/** Edit in a window: name, address and the point on the map. */
function EditSite({ data, onDone }: { data: SiteRow; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [address, setAddress] = useState(data.address ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null,
  );
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-3" onClick={onDone}>
      <form
        onClick={(e) => e.stopPropagation()}
        action={(fd) =>
          start(async () => {
            const r = await editSite(data.id, fd);
            if (r.error) setErr(r.error);
            else onDone();
          })
        }
        className="grid w-full max-w-lg gap-3 rounded-2xl bg-paper p-5 shadow-xl"
      >
        <p className="text-lg font-semibold">✎ საწყობის რედაქტირება</p>
        <label className="grid gap-1 text-sm">
          სახელი
          <input name="name" defaultValue={data.name} required className={inputClass} />
        </label>
        <label className="grid gap-1 text-sm">
          მისამართი
          <input
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="მისამართი"
            className={inputClass}
          />
        </label>
        <input type="hidden" name="lat" value={point?.lat ?? ''} />
        <input type="hidden" name="lng" value={point?.lng ?? ''} />
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="rounded-control border border-rule-strong px-3 py-2 text-sm"
        >
          📍 {point ? 'ლოკაციის შეცვლა რუკაზე' : 'ლოკაცია რუკაზე — მისამართი ავტომატურად'}
        </button>
        {point && (
          <p className="text-xs text-match">
            ✓ წერტილი: {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </p>
        )}
        {mapOpen && (
          <MapPicker
            start={point}
            onClose={() => setMapOpen(false)}
            onPick={(p, a) => {
              setPoint(p);
              if (a) setAddress(a);
              setMapOpen(false);
            }}
          />
        )}
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-control border border-rule-strong py-2.5"
          >
            გაუქმება
          </button>
          <Button type="submit" disabled={pending}>
            {pending ? '…' : 'შენახვა'}
          </Button>
        </div>
      </form>
    </div>
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
        valueGetter: (p) =>
          p.data?.lat != null && p.data?.lng != null ? mapsLink(p.data.lat, p.data.lng) : '',
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
        valueGetter: (p) =>
          p.data?.map_id ? `${window.location.origin}/manage/${p.data.map_id}/map?view=3d` : '',
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
    [],
  );
  const edited = rows.find((r) => r.id === editing);
  return (
    <>
      {edited && <EditSite data={edited} onDone={() => setEditing(null)} />}
      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        fileName="obieqtebi"
        height={Math.min(640, 150 + rows.length * 40)}
      />
    </>
  );
}
