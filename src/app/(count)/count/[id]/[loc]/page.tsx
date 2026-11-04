import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeEntry, StocktakeZone } from '@/types/database';
import CountPanel from './count-panel';
import RecountList from './recount-list';
import { closeZone, deleteEntry } from '../../actions';

type EntryRow = StocktakeEntry & { products: { name: string; sku: string; unit: string } | null };

const fmt = (n: number) => Number(n).toLocaleString('ka-GE', { maximumFractionDigits: 3 });

/**
 * Step 2: count one zone. The counter scans products and enters quantities.
 * Book quantities are never loaded here, so the count stays blind.
 */
export default async function ZonePage({ params }: PageProps<'/count/[id]/[loc]'>) {
  const { id, loc } = await params;
  const { userId, profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: stocktake }, { data: location }, { data: zone }] = await Promise.all([
    supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>(),
    supabase.from('locations').select('id, code, name').eq('id', loc).maybeSingle<{ id: string; code: string; name: string }>(),
    supabase.from('stocktake_zones').select('*').eq('stocktake_id', id).eq('location_id', loc).maybeSingle<StocktakeZone>(),
  ]);
  if (!stocktake || !location || !zone) notFound();

  const manager = profile.role === 'owner' || profile.role === 'admin';
  const canCount = stocktake.status === 'open' && (zone.counter_id === userId || manager);

  const { data: entries } = await supabase
    .from('stocktake_entries')
    .select('*, products (name, sku, unit)')
    .eq('stocktake_id', id)
    .eq('location_id', loc)
    .order('created_at', { ascending: false })
    .returns<EntryRow[]>();
  const rows = entries ?? [];

  const { data: checks } = await supabase
    .from('stocktake_checks')
    .select('product_id, attempts, status, products (name, sku)')
    .eq('stocktake_id', id)
    .eq('location_id', loc)
    .neq('status', 'ok')
    .returns<{ product_id: string; attempts: number; status: 'recount' | 'frozen'; products: { name: string; sku: string } | null }[]>();
  const recheck = (checks ?? [])
    .map((c) => ({ product_id: c.product_id, attempts: c.attempts, status: c.status, name: c.products?.name ?? '', sku: c.products?.sku ?? '' }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'recount' ? -1 : 1));
  const recountDue = recheck.some((c) => c.status === 'recount');

  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/count/${id}`} className="text-sm text-ink-faint">← {stocktake.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {location.code} <span className="text-base font-normal text-ink-soft">{location.name}</span>
        </h1>
        <p className="text-sm text-ink-faint">
          {zone.status === 'done' ? 'ზონა დასრულებულია' : 'ითვლება'} · ჩანაწერები: {rows.length}
        </p>
      </div>

      {canCount && recheck.length > 0 && <RecountList stocktakeId={id} locationId={loc} items={recheck} />}

      {canCount ? (
        <CountPanel stocktakeId={id} locationId={loc} />
      ) : (
        <p className="text-ink-soft">ამ ზონაში ჩაწერა შენთვის დახურულია.</p>
      )}

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-ink-faint">დათვლილი ამ ზონაში</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-faint">ჯერ არაფერი.</p>
        ) : (
          <ul className="grid gap-1">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-b border-rule/60 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.products?.name ?? <span className="text-review">❓ {e.unknown_label}</span>}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {e.products?.sku}
                    {e.boxes != null && e.per_box != null && ` · ${e.boxes} × ${fmt(e.per_box)}`}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {fmt(e.quantity)} <span className="text-xs font-normal text-ink-faint">{e.products?.unit ?? ''}</span>
                </p>
                {canCount && (e.counter_id === userId || manager) && (
                  <form action={deleteEntry.bind(null, id, loc, e.id)}>
                    <button type="submit" aria-label="წაშლა" className="px-2 text-ink-faint">✕</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canCount && zone.status === 'counting' && (
        <form action={closeZone.bind(null, id, loc)}>
          <button
            type="submit"
            className="w-full rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper"
          >
            {recountDue ? '↻ შემოწმება' : '✓ ზონის დასრულება'}
          </button>
        </form>
      )}
    </div>
  );
}
