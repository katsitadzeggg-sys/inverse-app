import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import ZoneOpener from './zone-opener';
import RoomOpener from './room-opener';
import { finishRoom } from '../actions';

type ZoneRow = StocktakeZone & { locations: { code: string } | null };

/**
 * The counter's view of a stocktake: where they are, the next shelf to open,
 * and their own shelves. Book, differences, exports and other people's work
 * live in the manager module (/manage).
 */
export default async function StocktakePage({ params }: PageProps<'/count/[id]'>) {
  const { id } = await params;
  const { userId } = await requireSession();
  const supabase = await createClient();

  const { data: stocktake } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  const { data: allowed } = await supabase.rpc('can_count_in', { p_stocktake: id });
  if (allowed === false) {
    return (
      <div className="grid gap-3">
        <Link href={stocktake.kind === 'assets' ? '/count' : '/stock'} className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink">← დაბრუნება</Link>
        <p className="text-ink-soft">ამ ინვენტარიზაციაზე არ ხარ დანიშნული. მიმართე მენეჯერს.</p>
      </div>
    );
  }

  const { data: zones } = await supabase
    .from('stocktake_zones')
    .select('*, locations (code)')
    .eq('stocktake_id', id)
    .eq('counter_id', userId)
    .order('started_at', { ascending: false })
    .returns<ZoneRow[]>();
  const mine = zones ?? [];
  // Fixed assets: the rooms named in the register, for one-tap start.
  let rooms: string[] = [];
  if (stocktake.kind === 'assets') {
    const { data: reg } = await supabase.from('asset_register').select('room').eq('stocktake_id', id).not('room', 'is', null).limit(5000);
    rooms = [...new Set((reg ?? []).map((r) => String(r.room).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 40);
  }
  const open = mine.find((z) => z.status === 'counting');

  return (
    <div className="grid gap-5">
      <div>
        <Link href={stocktake.kind === 'assets' ? '/count' : '/stock'} className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink">← დაბრუნება</Link>
        <h1 className="mt-1 text-xl font-semibold">{stocktake.client_name ?? stocktake.name}</h1>
        {stocktake.branch && <p className="text-ink-soft">{stocktake.branch}</p>}
        <p className="text-sm text-ink-faint">{stocktake.number}</p>
      </div>

      {stocktake.status !== 'open' ? (
        <p className="text-ink-soft">ინვენტარიზაცია დახურულია.</p>
      ) : open && stocktake.kind === 'assets' ? (
        <div className="grid gap-3">
          <Link href={`/count/${id}/${open.location_id}`} className="rounded-control bg-match px-4 py-4 text-center text-lg font-semibold text-white">
            ▶ გააგრძელე ოთახი {open.locations?.code}
          </Link>
          <form action={finishRoom.bind(null, id, open.location_id)}>
            <button type="submit" className="w-full rounded-control border-2 border-rule-strong px-4 py-4 text-lg font-semibold text-ink">
              🔒 ოთახი {open.locations?.code} — დახურვა
            </button>
          </form>
          {/* Or straight to the next room: the open one closes on the way. */}
          <RoomOpener stocktakeId={id} suggestions={rooms} close={open.location_id} />
        </div>
      ) : open ? (
        <Link href={`/count/${id}/${open.location_id}`} className="rounded-control bg-ink px-4 py-4 text-center text-base font-semibold text-paper">
          გააგრძელე {stocktake.kind === 'assets' ? 'ოთახი' : 'თარო'} {open.locations?.code} →
        </Link>
      ) : (
        <div id="shelf">
          {stocktake.kind === 'assets' ? (
            <RoomOpener stocktakeId={id} suggestions={rooms} />
          ) : (
            <ZoneOpener stocktakeId={id} client={stocktake.client_name ?? stocktake.name} branch={stocktake.branch ?? ''} />
          )}
        </div>
      )}

      {mine.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold text-ink-faint">ჩემი {stocktake.kind === 'assets' ? 'ოთახები' : 'თაროები'}: {mine.length}</h2>
          <ul className="grid gap-1">
            {mine.map((z) => (
              <li key={z.id}>
                <Link
                  href={z.status === 'done' ? `/count/${id}/${z.location_id}/done` : `/count/${id}/${z.location_id}`}
                  className="flex items-center justify-between rounded-control border border-rule/70 px-4 py-3"
                >
                  <span className="font-semibold">{z.locations?.code}</span>
                  <span className={z.status === 'done' ? 'text-match' : 'text-review'}>{z.status === 'done' ? '✓' : 'ითვლება'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
