import Link from 'next/link';
import BackButton from './back-button';
import { notFound, redirect, RedirectType } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import CountPanel from './count-panel';
import AssetPanel from './asset-panel';
import RecountList from './recount-list';
import { closeZone, finishZone } from '../../actions';
import type { AiResult } from '../../ai-actions';
import ShelfHud from './done/shelf-hud';

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
  // A closed shelf reached by the phone's Back (the counting page is still in
  // history): go to the shelf list, not forward again to the closed page —
  // that loop made Back seem dead. Links to a closed shelf go to /done directly.
  if (zone.status === 'done') redirect(`/count/${id}`, RedirectType.replace);

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
        {!canCount ? (
          <>
            <Link
              href={`/count/${id}`}
              className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
            >
              ← დაბრუნება
            </Link>
            <p className="text-ink-soft">ამ ოთახში ჩაწერა შენთვის დახურულია.</p>
          </>
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
              backHref={`/count/${id}`}
              title={
                /^\d+$/.test(location.code) ? `ოთახი №${location.code}` : `ოთახი ${location.code}`
              }
            />
          </>
        )}
      </div>
    );
  }

  // The last AI check of this shelf with its frames, for a manager who opens
  // the shelf again (25.11: the framed photos were gone, so the check was
  // paid for again). Counters cannot read AI checks.
  const { data: ai } = manager
    ? await supabase
        .from('shelf_ai_checks')
        .select('result, created_at')
        .eq('stocktake_id', id)
        .eq('location_id', loc)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ result: AiResult; created_at: string }>()
    : { data: null };
  const aiPaths = (ai?.result.paths ?? []).filter((p): p is string => !!p);
  const aiUrls: Record<string, string> = aiPaths.length
    ? Object.fromEntries(
        (
          (await supabase.storage.from('stocktake-media').createSignedUrls(aiPaths, 60 * 30))
            .data ?? []
        ).flatMap((x) => (x.path && x.signedUrl ? [[x.path, x.signedUrl] as const] : [])),
      )
    : {};
  const lastAi = ai ? (
    <details className="rounded-control border border-rule/70 p-3">
      <summary className="cursor-pointer font-semibold">
        🤖 ბოლო AI შემოწმება ·{' '}
        {new Date(ai.created_at).toLocaleTimeString('ka-GE', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Tbilisi',
        })}
      </summary>
      <p className="mt-2 text-sm">{ai.result.summary}</p>
      <div className="mt-2">
        <ShelfHud result={ai.result} urls={aiUrls} />
      </div>
    </details>
  ) : null;

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
  // What was counted on this shelf so far: the recount field starts from it (0 if nothing).
  const counted = new Map<string, number>();
  // The order the products were first counted on this shelf: the recount goes
  // in the same order, each with its number (Giorgi, 27.11).
  const order = new Map<string, number>();
  if ((checks ?? []).length) {
    const { data: seq } = await supabase
      .from('stocktake_entries')
      .select('product_id')
      .eq('stocktake_id', id)
      .eq('location_id', loc)
      .not('product_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(5000);
    for (const r of seq ?? [])
      if (!order.has(r.product_id as string)) order.set(r.product_id as string, order.size + 1);
  }
  if ((checks ?? []).length) {
    const { data: lines } = await supabase
      .from('stocktake_entries')
      .select('product_id, quantity')
      .eq('stocktake_id', id)
      .eq('location_id', loc)
      .in(
        'product_id',
        (checks ?? []).map((c) => c.product_id),
      );
    for (const l of lines ?? [])
      counted.set(
        l.product_id as string,
        (counted.get(l.product_id as string) ?? 0) + Number(l.quantity),
      );
  }
  const recount = (checks ?? [])
    .map((c) => ({
      product_id: c.product_id,
      name: c.products?.name ?? '',
      code: c.products?.barcode ?? c.products?.sku ?? '',
      qty: counted.get(c.product_id) ?? 0,
      pos: order.get(c.product_id) ?? null,
    }))
    // In counting order; never counted here (only in the book) go last.
    .sort((a, b) => (a.pos ?? 1e9) - (b.pos ?? 1e9) || a.name.localeCompare(b.name, 'ka'));

  return (
    <div className="grid gap-5">
      <div>
        <BackButton href={`/count/${id}`} />
        <h1 className="mt-1 text-2xl font-semibold">
          {location.code}{' '}
          {location.name !== location.code && !location.name.includes(location.code) && (
            <span className="text-base font-normal text-ink-soft">{location.name}</span>
          )}
        </h1>
      </div>

      {!canCount ? (
        <p className="text-ink-soft">ამ თაროზე ჩაწერა შენთვის დახურულია.</p>
      ) : recount.length > 0 ? (
        <>
          {lastAi}
          <RecountList
            stocktakeId={id}
            locationId={loc}
            shelf={location.code}
            items={recount}
            expiry={stocktake.kind === 'expiry'}
          />
          {stocktake.kind === 'expiry' && (
            <form action={closeZone.bind(null, id, loc)}>
              <button
                type="submit"
                className="w-full rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper"
              >
                ↻ გადათვლა
              </button>
            </form>
          )}
          <form action={finishZone.bind(null, id, loc)}>
            <button
              type="submit"
              className="w-full rounded-control bg-mismatch px-4 py-5 text-xl font-semibold text-white shadow-md active:opacity-80"
            >
              🔒 თაროს დახურვა
            </button>
          </form>
        </>
      ) : (
        <>
          {lastAi}
          <CountPanel
            stocktakeId={id}
            locationId={loc}
            companyId={company.id}
            expiry={stocktake.kind === 'expiry'}
            countDate={stocktake.count_date}
            footer={
              <form action={closeZone.bind(null, id, loc)}>
                <button
                  type="submit"
                  className="w-full rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper"
                >
                  ✓ თაროს გადამოწმება
                </button>
              </form>
            }
          />
        </>
      )}
    </div>
  );
}
