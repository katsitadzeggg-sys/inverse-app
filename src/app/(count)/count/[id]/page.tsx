import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import ZoneOpener from './zone-opener';
import RoomOpener from './room-opener';
import { finishRoom, setMyCountFinished } from '../actions';

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

  const { data: stocktake } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  const { data: allowed } = await supabase.rpc('can_count_in', { p_stocktake: id });
  if (allowed === false) {
    return (
      <div className="grid gap-3">
        <Link
          href={stocktake.kind === 'assets' ? '/count' : '/stock'}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
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
    const { data: reg } = await supabase
      .from('asset_register')
      .select('room')
      .eq('stocktake_id', id)
      .not('room', 'is', null)
      .limit(5000);
    rooms = [...new Set((reg ?? []).map((r) => String(r.room).trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 40);
  }
  // Stock: the company's shelves to pick from while typing (not the rooms of fixed-asset counts).
  let shelves: string[] = [];
  if (stocktake.kind !== 'assets') {
    // Read in pages: the server hands out at most 1 000 rows per call.
    const readShelves = async () => {
      const all: { id: string; code: string }[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data } = await supabase
          .from('locations')
          .select('id, code')
          .eq('kind', 'shelf')
          .order('code')
          .range(from, from + 999);
        all.push(...((data ?? []) as { id: string; code: string }[]));
        if (!data || data.length < 1000) break;
      }
      return { data: all };
    };
    const [{ data: locs }, { data: roomZones }] = await Promise.all([
      readShelves(),
      supabase
        .from('stocktake_zones')
        .select('location_id, stocktakes!inner(kind)')
        .eq('stocktakes.kind', 'assets')
        .limit(5000),
    ]);
    const roomIds = new Set((roomZones ?? []).map((z) => z.location_id as string));
    shelves = (locs ?? [])
      .filter((l) => !roomIds.has(l.id) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(l.code))
      .map((l) => l.code)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const open = mine.find((z) => z.status === 'counting');
  const { data: fin } = await supabase
    .from('stocktake_finished')
    .select('finished_at')
    .eq('stocktake_id', id)
    .eq('user_id', userId)
    .maybeSingle<{ finished_at: string | null }>();
  const finishedAt = fin?.finished_at ?? null;
  const unit = stocktake.kind === 'assets' ? 'ოთახი' : 'თარო';
  // Fixed assets, room open: what the register puts in this room but nobody has found yet.
  let left: { inv_no: string; name: string }[] = [];
  let roomTotal = 0;
  if (stocktake.kind === 'assets' && open?.locations?.code) {
    const { data: inRoom } = await supabase
      .from('asset_register')
      .select('inv_no, name')
      .eq('stocktake_id', id)
      .eq('room', open.locations.code)
      .order('inv_no')
      .limit(1000);
    roomTotal = inRoom?.length ?? 0;
    if (roomTotal) {
      const found = new Set<string>();
      const invs = (inRoom ?? []).map((r) => r.inv_no as string);
      for (let i = 0; i < invs.length; i += 300) {
        const { data } = await supabase
          .from('asset_checks')
          .select('inv_no')
          .eq('stocktake_id', id)
          .in('inv_no', invs.slice(i, i + 300));
        for (const c of data ?? []) found.add(c.inv_no as string);
      }
      left = (inRoom ?? []).filter((r) => !found.has(r.inv_no as string)) as typeof left;
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href={stocktake.kind === 'assets' ? '/count' : '/stock'}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{stocktake.client_name ?? stocktake.name}</h1>
        {stocktake.branch && <p className="text-ink-soft">{stocktake.branch}</p>}
        <p className="text-sm text-ink-faint">{stocktake.number}</p>
      </div>

      {stocktake.status !== 'open' ? (
        <p className="text-ink-soft">ინვენტარიზაცია დახურულია.</p>
      ) : finishedAt ? (
        <div className="grid gap-3 rounded-control border-2 border-match/60 bg-match/5 p-4 text-center">
          <p className="text-lg font-semibold text-match">🏁 აღწერა დაასრულე</p>
          <p className="text-sm text-ink-soft">
            {new Date(finishedAt).toLocaleString('ka-GE', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}{' '}
            · მენეჯერი ხედავს, რომ დაასრულე.
          </p>
          <form action={setMyCountFinished.bind(null, id, false)}>
            <button
              type="submit"
              className="w-full rounded-control border border-rule-strong px-4 py-3 text-base font-medium"
            >
              ↩ აღწერის გაგრძელება
            </button>
          </form>
        </div>
      ) : open && stocktake.kind === 'assets' ? (
        <div className="grid gap-3">
          <Link
            href={`/count/${id}/${open.location_id}`}
            className="rounded-control bg-match px-4 py-4 text-center text-lg font-semibold text-white"
          >
            ▶ გააგრძელე ოთახი {open.locations?.code}
          </Link>
          {roomTotal > 0 &&
            (left.length ? (
              <details className="rounded-control border border-review/60 bg-review/5 px-4 py-3">
                <summary className="cursor-pointer font-semibold text-review">
                  ⚠ ოთახში დარჩა: {left.length} / {roomTotal} — რეესტრით აქ უნდა იყოს, ჯერ არ
                  მოძებნილა
                </summary>
                <ul className="mt-2 grid max-h-72 gap-1 overflow-y-auto text-sm">
                  {left.map((r) => (
                    <li key={r.inv_no} className="flex gap-2">
                      <span className="shrink-0 font-semibold tabular-nums">{r.inv_no}</span>
                      <span className="min-w-0 break-words text-ink-soft">{r.name}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="rounded-control border border-match/50 bg-match/5 px-4 py-3 text-sm font-semibold text-match">
                ✓ რეესტრის ყველა ნივთი ({roomTotal}) ნაპოვნია
              </p>
            ))}
          <form action={finishRoom.bind(null, id, open.location_id)}>
            <button
              type="submit"
              className="w-full rounded-control border-2 border-rule-strong px-4 py-4 text-lg font-semibold text-ink"
            >
              🔒 ოთახი {open.locations?.code} — დახურვა
            </button>
          </form>
          {/* Or straight to the next room: the open one closes on the way. */}
          <RoomOpener stocktakeId={id} suggestions={rooms} close={open.location_id} />
        </div>
      ) : open ? (
        <Link
          href={`/count/${id}/${open.location_id}`}
          className="rounded-control bg-match px-4 py-5 text-center text-xl font-semibold text-white"
        >
          გააგრძელე {stocktake.kind === 'assets' ? 'ოთახი' : 'თარო'} {open.locations?.code} →
        </Link>
      ) : (
        <div id="shelf">
          {stocktake.kind === 'assets' ? (
            <RoomOpener stocktakeId={id} suggestions={rooms} />
          ) : (
            <ZoneOpener stocktakeId={id} shelves={shelves} />
          )}
        </div>
      )}

      {mine.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold text-ink-faint">
            ჩემი {stocktake.kind === 'assets' ? 'ოთახები' : 'თაროები'}: {mine.length}
          </h2>
          <ul className="grid gap-1">
            {mine.map((z) => (
              <li key={z.id}>
                <Link
                  href={
                    z.status === 'done'
                      ? `/count/${id}/${z.location_id}/done`
                      : `/count/${id}/${z.location_id}`
                  }
                  className="flex items-center justify-between rounded-control border border-rule/70 px-4 py-3"
                >
                  <span className="font-semibold">{z.locations?.code}</span>
                  <span className={z.status === 'done' ? 'text-match' : 'text-review'}>
                    {z.status === 'done' ? '✓' : 'ითვლება'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stocktake.status === 'open' && !finishedAt && mine.length > 0 && (
        <section className="grid gap-2 border-t border-rule/60 pt-4">
          {open ? (
            <p className="text-center text-sm text-ink-faint">
              დასასრულებლად ჯერ დახურე {unit} {open.locations?.code}.
            </p>
          ) : (
            <form action={setMyCountFinished.bind(null, id, true)}>
              <button
                type="submit"
                className="w-full rounded-control border-2 border-ink px-4 py-4 text-lg font-semibold"
              >
                🏁 აღწერა დავასრულე
              </button>
            </form>
          )}
          <p className="text-center text-xs text-ink-faint">
            დააჭირე, როცა შენი ნაწილი სრულად დათვლილია — მენეჯერს ეცნობება.
          </p>
        </section>
      )}
    </div>
  );
}
