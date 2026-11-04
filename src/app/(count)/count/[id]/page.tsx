import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import ZoneOpener from './zone-opener';
import ExportBox from './export-box';
import { mapsLink } from '@/lib/geo';

type ZoneRow = StocktakeZone & {
  locations: { code: string; name: string } | null;
  user_profiles: { full_name: string | null; email: string } | null;
};

export default async function StocktakePage({ params }: PageProps<'/count/[id]'>) {
  const { id } = await params;
  const { userId, profile } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';
  const supabase = await createClient();

  const { data: stocktake } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!stocktake) notFound();

  const { data: zones } = await supabase
    .from('stocktake_zones')
    .select('*, locations (code, name), user_profiles (full_name, email)')
    .eq('stocktake_id', id)
    .order('started_at', { ascending: false })
    .returns<ZoneRow[]>();

  const mine = (zones ?? []).filter((z) => z.counter_id === userId);
  const others = (zones ?? []).filter((z) => z.counter_id !== userId);
  const done = (zones ?? []).filter((z) => z.status === 'done').length;

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/count" className="text-sm text-ink-faint">← ინვენტარიზაციები</Link>
        <p className="mt-1 text-sm text-ink-faint">{stocktake.number} · {new Date(stocktake.count_date).toLocaleDateString('ka-GE')}</p>
        <h1 className="text-xl font-semibold">{stocktake.client_name ?? stocktake.name}</h1>
        {stocktake.branch && <p className="text-ink-soft">{stocktake.branch}</p>}
        {(stocktake.address || stocktake.lat != null) && (
          <p className="text-sm text-ink-soft">
            📍 {stocktake.address ?? ''}
            {stocktake.lat != null && stocktake.lng != null && (
              <> <a href={mapsLink(stocktake.lat, stocktake.lng)} target="_blank" rel="noreferrer" className="underline">რუკაზე</a></>
            )}
          </p>
        )}
        <p className="text-sm text-ink-faint">
          თაროები: {zones?.length ?? 0} · დასრულებული: {done}
        </p>
      </div>

      {(zones ?? []).length > 0 && <ExportBox stocktakeId={id} number={stocktake.number} shelves={(zones ?? []).map((z) => ({ id: z.location_id, code: z.locations?.code ?? '' }))} />}

      {manager && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Link href={`/count/${id}/book`} className="rounded-control border border-rule-strong px-3 py-3 text-center">📄 ნაშთის ჩატვირთვა</Link>
          <Link href={`/count/${id}/report`} className="rounded-control border border-rule-strong px-3 py-3 text-center">📊 სხვაობები</Link>
        </div>
      )}

      {stocktake.status === 'open' ? (
        <div id="shelf">
          <ZoneOpener stocktakeId={id} client={stocktake.client_name ?? stocktake.name} branch={stocktake.branch ?? ''} />
        </div>
      ) : (
        <p className="text-ink-soft">ინვენტარიზაცია დახურულია.</p>
      )}

      {mine.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold text-ink-faint">ჩემი ზონები</h2>
          <ul className="grid gap-2">
            {mine.map((z) => (
              <li key={z.id}>
                <Link
                  href={`/count/${id}/${z.location_id}`}
                  className="flex items-center justify-between rounded-control border border-rule-strong px-4 py-3"
                >
                  <span>
                    <span className="font-semibold">{z.locations?.code}</span>{' '}
                    <span className="text-ink-soft">{z.locations?.name}</span>
                  </span>
                  <span className={z.status === 'done' ? 'text-match' : 'text-review'}>
                    {z.status === 'done' ? 'დასრულება' : 'ითვლება'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold text-ink-faint">სხვების ზონები</h2>
          <ul className="grid gap-1 text-sm">
            {others.map((z) => (
              <li key={z.id} className="flex justify-between border-b border-rule/60 py-1.5">
                <span>
                  {z.locations?.code} · {z.user_profiles?.full_name ?? z.user_profiles?.email}
                </span>
                <span className={z.status === 'done' ? 'text-match' : 'text-review'}>
                  {z.status === 'done' ? 'დასრულება' : 'ითვლება'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
