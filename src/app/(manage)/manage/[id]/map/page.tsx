import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { productShelves, warehousePool, type FoundProduct } from '@/lib/shelf-finder';
import AutoRefresh from './auto-refresh';
import MapView, { type MapTile } from './map-view';

/**
 * Live map of a warehouse: every shelf as a tile, coloured by state — not
 * opened yet, being counted (and by whom), done and matching, done with
 * differences. By default all stocktakes of the warehouse together (they are
 * one count); "this stocktake" narrows it. A search finds a shelf by its code
 * or by a product on it; ?focus=missed|review marks the shelves of the
 * warehouse's missed / to-re-check products.
 */
export default async function StocktakeMap({
  params,
  searchParams,
}: PageProps<'/manage/[id]/map'>) {
  const { id } = await params;
  const sp = await searchParams;
  const view3d = sp.view === '3d';
  const focus: 'missed' | 'review' | null =
    sp.focus === 'missed' || sp.focus === 'review' ? sp.focus : null;
  await requireSession();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();

  const pool = (await warehousePool(supabase, id)) ?? { key: st.name, ids: [id] };
  const whole = sp.scope !== 'one' && pool.ids.length > 1;
  const ids = whole || focus ? pool.ids : [id];

  const [{ data: zones }, { data: checks }, { data: book }] = await Promise.all([
    supabase
      .from('stocktake_zones')
      .select(
        'stocktake_id, location_id, status, started_at, locations (code), user_profiles (full_name, email)',
      )
      .in('stocktake_id', ids)
      .order('started_at', { ascending: true })
      .limit(20000)
      .returns<
        {
          stocktake_id: string;
          location_id: string;
          status: string;
          locations: { code: string } | null;
          user_profiles: { full_name: string | null; email: string } | null;
        }[]
      >(),
    supabase
      .from('stocktake_checks')
      .select('stocktake_id, location_id, status')
      .in('stocktake_id', ids)
      .neq('status', 'ok')
      .limit(20000)
      .returns<{ stocktake_id: string; location_id: string; status: string }[]>(),
    supabase
      .from('stocktake_book')
      .select('location_id, locations (code)')
      .in('stocktake_id', ids)
      .not('location_id', 'is', null)
      .limit(50000)
      .returns<{ location_id: string; locations: { code: string } | null }[]>(),
  ]);

  const diffs = new Set((checks ?? []).map((c) => `${c.stocktake_id}:${c.location_id}`));
  const tiles = new Map<string, MapTile>();
  for (const b of book ?? [])
    if (b.locations)
      tiles.set(b.location_id, { id: b.location_id, code: b.locations.code, state: 'idle' });
  // Oldest first: the latest stocktake's state of a shelf wins.
  for (const z of zones ?? []) {
    const state: MapTile['state'] =
      z.status !== 'done'
        ? 'counting'
        : diffs.has(`${z.stocktake_id}:${z.location_id}`)
          ? 'diff'
          : 'ok';
    tiles.set(z.location_id, {
      id: z.location_id,
      code: z.locations?.code ?? '?',
      state,
      who: z.user_profiles?.full_name ?? z.user_profiles?.email,
      href: `/count/${z.stocktake_id}/${z.location_id}/done`,
    });
  }

  // The warehouse's missed / to-re-check products and where they are.
  let focused: FoundProduct[] = [];
  if (focus) {
    const { data: lines } = await supabase.rpc('pool_lines', { p_ids: pool.ids });
    const pids = ((lines ?? []) as { product_id: string; status: string }[])
      .filter((l) => l.status === focus)
      .map((l) => l.product_id)
      .slice(0, 2000);
    const [where, prods] = await Promise.all([
      productShelves(supabase, pool.ids, pids),
      (async () => {
        const all: {
          id: string;
          name: string;
          sku: string;
          barcode: string | null;
          unit: string | null;
        }[] = [];
        for (let i = 0; i < pids.length; i += 300) {
          const { data } = await supabase
            .from('products')
            .select('id, name, sku, barcode, unit')
            .in('id', pids.slice(i, i + 300));
          all.push(...(data ?? []));
        }
        return all;
      })(),
    ]);
    focused = prods
      .map((p) => ({
        id: p.id,
        name: p.name,
        code: p.barcode ?? p.sku,
        unit: p.unit,
        status: focus,
        shelves: where.get(p.id) ?? [],
      }))
      .sort(
        (a, b) =>
          (a.shelves[0]?.code ?? '￿').localeCompare(b.shelves[0]?.code ?? '￿', undefined, {
            numeric: true,
          }) || a.name.localeCompare(b.name, 'ka'),
      );
    for (const p of focused)
      for (const s of p.shelves)
        if (!tiles.has(s.locationId))
          tiles.set(s.locationId, { id: s.locationId, code: s.code, state: 'idle' });
  }

  const base = `/manage/${id}/map`;
  const q = (o: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const merged = { view: view3d ? '3d' : null, scope: whole ? null : 'one', focus, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const tab = (on: boolean) =>
    `rounded-control border px-3 py-2 ${on ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`;

  return (
    <div className="grid gap-5">
      <AutoRefresh />
      <div>
        <Link
          href={focus ? '/manage/stocktakes' : `/manage/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          რუკა ·{' '}
          {whole || focus ? `${pool.key} (${pool.ids.length} ინვ.)` : (st.client_name ?? st.name)}
        </h1>
        <p className="text-sm text-ink-soft">
          ახლდება ყოველ 30 წამში. მოძებნე თარო ან პროდუქტი — თარო აინთება. დააჭირე თაროს — გაიხსნება
          მისი შედეგი.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Link href={q({ view: null })} className={tab(!view3d)}>
            ▦ ბადე
          </Link>
          <Link href={q({ view: '3d' })} className={tab(view3d)}>
            🧊 3D
          </Link>
          {pool.ids.length > 1 && !focus && (
            <>
              <span className="mx-1 w-px bg-rule" />
              <Link href={q({ scope: null })} className={tab(whole)}>
                მთელი საწყობი
              </Link>
              <Link href={q({ scope: 'one' })} className={tab(!whole)}>
                მხოლოდ ეს ინვენტარიზაცია
              </Link>
            </>
          )}
          {focus && (
            <Link
              href={q({ focus: null })}
              className="rounded-control border border-rule-strong px-3 py-2"
            >
              ✕ {focus === 'missed' ? 'გამორჩენილის' : 'გადასამოწმებლის'} მონიშვნის მოხსნა
            </Link>
          )}
        </div>
      </div>

      <MapView
        stocktakeId={id}
        tiles={[...tiles.values()]}
        view3d={view3d}
        focus={focus}
        focused={focused}
        initialQuery={typeof sp.find === 'string' ? sp.find : ''}
      />
    </div>
  );
}
