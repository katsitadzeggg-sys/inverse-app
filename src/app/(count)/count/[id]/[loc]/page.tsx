import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import CountPanel from './count-panel';
import AssetPanel from './asset-panel';
import RecountList from './recount-list';
import RoomOpener from '../room-opener';
import { closeZone, finishZone } from '../../actions';

/**
 * One shelf. Counting: scan, quantity, Next — then “check the shelf”, which
 * compares with the book without showing it. If items differ, only those stay
 * on screen to be recounted; “recount” checks again and drops the ones that now
 * match; “close the shelf” ends it. Then the shelf summary page.
 */
export default async function ZonePage({ params }: PageProps<'/count/[id]/[loc]'>) {
  const { id, loc } = await params;
  const { userId, profile, company } = await requireSession();
  const supabase = await createClient();

  const [{ data: stocktake }, { data: location }, { data: zone }] = await Promise.all([
    supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>(),
    supabase
      .from('locations')
      .select('id, code, name')
      .eq('id', loc)
      .maybeSingle<{ id: string; code: string; name: string }>(),
    supabase
      .from('stocktake_zones')
      .select('*')
      .eq('stocktake_id', id)
      .eq('location_id', loc)
      .maybeSingle<StocktakeZone>(),
  ]);
  if (!stocktake || !location || !zone) notFound();
  if (zone.status === 'done') redirect(`/count/${id}/${loc}/done`);

  const manager = profile.role === 'owner' || profile.role === 'admin';
  const canCount = stocktake.status === 'open' && (zone.counter_id === userId || manager);

  // Fixed assets: a room, not a shelf. Scan labels, then close the room.
  if (stocktake.kind === 'assets') {
    const { count: recorded } = await supabase
      .from('asset_checks')
      .select('id', { count: 'exact', head: true })
      .eq('stocktake_id', id)
      .eq('location_id', loc);
    const n = recorded ?? 0;
    return (
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/count"
            className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
          >
            ← დაბრუნება
          </Link>
          <h1 className="truncate text-2xl font-semibold">
            ოთახი {/^\d+$/.test(location.code) ? `№${location.code}` : location.code}
          </h1>
        </div>
        {!canCount ? (
          <p className="text-ink-soft">ამ ოთახში ჩაწერა შენთვის დახურულია.</p>
        ) : (
          <>
            <AssetPanel
              stocktakeId={id}
              locationId={loc}
              room={location.code}
              companyId={company.id}
              userId={userId}
              author={profile.full_name ?? profile.email}
              company={stocktake.client_name ?? stocktake.name}
              branch={stocktake.branch}
              recorded={n}
              footer={
                n > 0 ? (
                  <details className="mt-6 rounded-control border border-rule-strong">
                    <summary className="cursor-pointer list-none px-4 py-3 text-center text-base text-ink-soft [&::-webkit-details-marker]:hidden">
                      🚪 ოთახი დავასრულე
                    </summary>
                    <div className="grid gap-3 border-t border-rule/70 p-3">
                      <RoomOpener stocktakeId={id} suggestions={[]} close={loc} />
                      <form action={finishZone.bind(null, id, loc)}>
                        <button
                          type="submit"
                          className="w-full rounded-control border border-rule-strong px-4 py-3 text-base text-ink-soft"
                        >
                          🏁 ოთახები აღარ არის — დასრულება
                        </button>
                      </form>
                    </div>
                  </details>
                ) : null
              }
            />
          </>
        )}
      </div>
    );
  }

  const { data: checks } = await supabase
    .from('stocktake_checks')
    .select('product_id, status, products (name, sku, barcode)')
    .eq('stocktake_id', id)
    .eq('location_id', loc)
    .eq('status', 'recount')
    .returns<
      {
        product_id: string;
        status: 'recount';
        products: { name: string; sku: string; barcode: string | null } | null;
      }[]
    >();
  const recount = (checks ?? [])
    .map((c) => ({
      product_id: c.product_id,
      name: c.products?.name ?? '',
      code: c.products?.barcode ?? c.products?.sku ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href={`/count/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {location.code}{' '}
          {location.name !== location.code && (
            <span className="text-base font-normal text-ink-soft">{location.name}</span>
          )}
        </h1>
      </div>

      {!canCount ? (
        <p className="text-ink-soft">ამ თაროზე ჩაწერა შენთვის დახურულია.</p>
      ) : recount.length > 0 ? (
        <>
          <RecountList
            stocktakeId={id}
            locationId={loc}
            shelf={location.code}
            items={recount}
            expiry={stocktake.kind === 'expiry'}
          />
          <form action={closeZone.bind(null, id, loc)}>
            <button
              type="submit"
              className="w-full rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper"
            >
              ↻ გადათვლა
            </button>
          </form>
          <form action={finishZone.bind(null, id, loc)}>
            <button
              type="submit"
              className="w-full rounded-control border-2 border-mismatch/60 px-4 py-3 text-base font-semibold text-mismatch"
            >
              🔒 თაროს დახურვა
            </button>
          </form>
        </>
      ) : (
        <>
          <CountPanel
            stocktakeId={id}
            locationId={loc}
            expiry={stocktake.kind === 'expiry'}
            countDate={stocktake.count_date}
          />
          <form action={closeZone.bind(null, id, loc)}>
            <button
              type="submit"
              className="w-full rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper"
            >
              ✓ თაროს გადამოწმება
            </button>
          </form>
        </>
      )}
    </div>
  );
}
