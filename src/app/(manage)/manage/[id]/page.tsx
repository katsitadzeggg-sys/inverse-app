import { cycleCode, cycleName } from '@/lib/cycles';
import Link from 'next/link';
import TopbarSlot from '@/components/topbar-slot';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { setShowBook, setStocktakeArchived, setStocktakeStatus } from '@/app/(count)/count/actions';
import ExportBox from './export-box';
import { stockActData } from '@/lib/stock-act';
import ShelvesView, { type ShelfRow } from './shelves-view';

type ZoneRow = StocktakeZone & {
  locations: { code: string } | null;
  user_profiles: { full_name: string | null; email: string } | null;
};

/**
 * Everything the manager receives from one stocktake: details, book import,
 * differences, downloads, and every shelf with who counted it, when, where,
 * how many lines, open differences, notes and photos.
 */
export default async function ManageStocktake({ params }: PageProps<'/manage/[id]'>) {
  const { id } = await params;
  const { company } = await requireSession();
  const supabase = await createClient();

  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();
  // Its cycle, shown beside the number ("· C4 2026 წლის ბოლო აღწერა").
  const { data: cy } = st.cycle_id
    ? await supabase
        .from('count_cycles')
        .select('name, code, started_at')
        .eq('id', st.cycle_id)
        .maybeSingle<{ name: string | null; code: number | null; started_at: string }>()
    : { data: null };

  const { data: zones } = await supabase
    .from('stocktake_zones')
    .select('*, locations (code), user_profiles (full_name, email)')
    .eq('stocktake_id', id)
    .order('started_at')
    .returns<ZoneRow[]>();
  const list = zones ?? [];
  const [{ count: regCount }, { count: foundCount }] =
    st.kind === 'assets'
      ? await Promise.all([
          supabase
            .from('asset_register')
            .select('id', { count: 'exact', head: true })
            .eq('stocktake_id', id),
          supabase
            .from('asset_checks')
            .select('id', { count: 'exact', head: true })
            .eq('stocktake_id', id),
        ])
      : [{ count: 0 }, { count: 0 }];
  const done = list.filter((z) => z.status === 'done').length;
  // Stock: what was counted, in Balance's table layout (counted lines only;
  // the act page has every line of the book).
  // The photo check's match probability per product (none until a shelf is checked).
  const { data: aiRows } = await supabase.rpc('stocktake_ai_lines', { p_stocktake: id });
  const aiLines = Object.fromEntries(
    (
      (aiRows ?? []) as {
        product_id: string;
        confidence: number;
        status: string;
        detected: number;
      }[]
    ).map((r) => [
      r.product_id,
      { confidence: Number(r.confidence), status: r.status, detected: Number(r.detected) },
    ]),
  );
  const balance =
    st.kind === 'assets'
      ? null
      : await stockActData(supabase, id).then((d) => ({
          hasCost: d.hasCost,
          final: d.final,
          // Counted lines; while open also the shortages of closed shelves.
          lines: d.lines
            .filter((l) => l.shelves.length > 0 || l.counted !== 0 || (!d.final && l.diff !== 0))
            .map((l, i) => ({ ...l, n: i + 1 })),
        }));
  // The shelves: who counted, when closed, lines, open differences, photos.
  const [{ data: entryRows }, { data: checkRows }, { data: mediaRows }] = await Promise.all([
    supabase
      .from('stocktake_entries')
      .select('location_id, quantity')
      .eq('stocktake_id', id)
      .limit(20000)
      .returns<{ location_id: string; quantity: number }[]>(),
    supabase
      .from('stocktake_checks')
      .select('location_id')
      .eq('stocktake_id', id)
      .neq('status', 'ok')
      .returns<{ location_id: string }[]>(),
    supabase
      .from('stocktake_media')
      .select('location_id')
      .eq('stocktake_id', id)
      .returns<{ location_id: string }[]>(),
  ]);
  const tally = (rows: { location_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.location_id, (m.get(r.location_id) ?? 0) + 1);
    return m;
  };
  const zLines = tally(entryRows);
  const zDiffs = tally(checkRows);
  const zShots = tally(mediaRows);
  const zQty = new Map<string, number>();
  for (const e of entryRows ?? [])
    zQty.set(e.location_id, (zQty.get(e.location_id) ?? 0) + Number(e.quantity));
  const shelfRows: ShelfRow[] = list
    .map((z) => ({
      locationId: z.location_id,
      code: z.locations?.code ?? '',
      counter: z.user_profiles?.full_name ?? '',
      email: z.user_profiles?.email ?? '',
      done: z.status === 'done',
      at: new Date(z.done_at ?? z.started_at).toLocaleString('ka-GE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tbilisi',
      }),
      entries: zLines.get(z.location_id) ?? 0,
      qty: zQty.get(z.location_id) ?? 0,
      diffs: zDiffs.get(z.location_id) ?? 0,
      shots: zShots.get(z.location_id) ?? 0,
      note: z.note,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));

  // Action buttons: solid green, clearly different from the info tiles.
  // Actions: one green main action, the rest light — less heavy than five green blocks.
  const btn =
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-rule-strong bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:border-[#1f7a4d] hover:text-[#155c39]';
  const main =
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-[#1f7a4d] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#155c39]';
  const tile = 'rounded-control border border-rule bg-paper-sunk p-2';

  return (
    <div className="grid gap-3">
      {/* Header: back, name; below it number · date · cycle · address; the book switch right. */}
      <TopbarSlot>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/manage/stocktakes?kind=${st.kind}`}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule-strong text-lg text-ink hover:bg-paper"
            aria-label="დაბრუნება"
            title="დაბრუნება"
          >
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight">
              {st.branch ?? st.client_name ?? st.name}
              {st.branch && st.client_name && (
                <span className="text-base font-normal text-ink-faint"> · {st.client_name}</span>
              )}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-faint">
              <span>
                {st.kind === 'expiry' ? '⏳' : st.kind === 'assets' ? '🏷' : '📦'} {st.number}
              </span>
              <span>· {new Date(st.count_date).toLocaleDateString('ka-GE')}</span>
              {cy && (
                <Link href="/manage/cycles" className="hover:underline">
                  · {cycleCode(cy.code)} {cycleName(cy, company.cycle_period)}
                </Link>
              )}
              {(st.address || st.lat != null) &&
                (st.lat != null && st.lng != null ? (
                  <a
                    href={mapsLink(st.lat, st.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    · 📍 {st.address || 'რუკაზე'}
                  </a>
                ) : (
                  <span>· 📍 {st.address}</span>
                ))}
            </p>
          </div>
          {st.kind !== 'assets' && (
            // Counters see the book quantity while counting (on), or count blind (off).
            <form action={setShowBook.bind(null, id, !st.show_book)} className="ml-auto">
              <button
                type="submit"
                role="switch"
                aria-checked={st.show_book}
                title={
                  st.show_book
                    ? 'დააჭირე — ბრმა დათვლა'
                    : 'დააჭირე — აღწერის თანამშრომელს ნაშთი გამოუჩნდება'
                }
                className="flex items-center gap-2 rounded-full border border-rule px-3 py-1.5 text-sm text-ink-soft hover:bg-paper"
              >
                👁 ნაშთი აღმწერს
                <span
                  className={`relative inline-block h-5 w-9 rounded-full transition ${st.show_book ? 'bg-[#16a34a]' : 'bg-[#cbd5d0]'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${st.show_book ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </span>
                <b className={st.show_book ? 'text-[#1f9d5c]' : 'text-ink-faint'}>
                  {st.show_book ? 'უჩანს' : 'არ უჩანს'}
                </b>
              </button>
            </form>
          )}
        </div>
      </TopbarSlot>

      {st.kind === 'assets' && (
        // Fixed assets: the register figures (the list's figures are for stock).
        <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
          <div className={tile}>
            <p className="text-xl font-semibold">
              {done}/{list.length}
            </p>
            ოთახი დასრულდა
          </div>
          <div className={tile}>
            <p className="text-xl font-semibold">{foundCount ?? 0}</p>ჩაწერილი
          </div>
          <div className={tile}>
            <p className="text-xl font-semibold">{regCount ?? 0}</p>რეესტრში
          </div>
          <div className={tile}>
            <p className="text-xl font-semibold text-review">
              {Math.max(0, (regCount ?? 0) - (foundCount ?? 0))}
            </p>
            ჯერ ვერ ნაპოვნი
          </div>
        </div>
      )}

      {st.kind === 'assets' ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/count/${id}/report`} className={main}>
            📊 შედეგი
          </Link>
          <Link href={`/count/${id}/register`} className={btn}>
            📄 რეესტრი
          </Link>
          <Link href={`/count/${id}/labels`} className={btn}>
            🏷 ეტიკეტები
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Link href={`/count/${id}/report`} className={main}>
            {st.kind === 'expiry' ? '📊 სხვაობები / ვადები' : '📊 სხვაობები'}
          </Link>
          <Link href={`/count/${id}/book`} className={btn}>
            📄 ნაშთი
          </Link>
          <Link href={`/manage/${id}/act`} className={btn}>
            🖨 აქტი
          </Link>
          <Link href={`/count/${id}/labels`} className={btn}>
            🏷 ეტიკეტები
          </Link>
          {/* The app's own map: shelves, what is left to count, what to re-check. */}
          <Link href={`/manage/${id}/map?view=3d`} className={btn}>
            🏗 3D რუკა
          </Link>
        </div>
      )}

      {list.length > 0 && (
        <ExportBox
          stocktakeId={id}
          number={st.number}
          shelves={list.map((z) => ({ id: z.location_id, code: z.locations?.code ?? '' }))}
        />
      )}

      {balance && (
        <ShelvesView
          id={id}
          shelves={shelfRows}
          lines={balance.lines}
          hasCost={balance.hasCost}
          fileName={st.number}
          ai={aiLines}
        />
      )}

      {!balance && list.length > 0 && (
        <details className="rounded-control border border-rule/70">
          <summary className="px-3 py-2 text-sm font-semibold">🗂 თაროები ({list.length})</summary>
          <div className="max-h-[45vh] overflow-auto border-t border-rule/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-paper-sunk text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-2 py-1">თარო</th>
                  <th className="px-2 py-1">თანამშრომელი</th>
                  <th className="px-2 py-1">ელფოსტა</th>
                  <th className="px-2 py-1">სტატუსი</th>
                  <th className="px-2 py-1 text-right">ჩანაწ.</th>
                  <th className="px-2 py-1 text-right">სხვაობა</th>
                  <th className="px-2 py-1 text-right">📷</th>
                  <th className="px-2 py-1">კომენტარი</th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => (
                  <tr key={z.id} className="border-t border-rule/60 align-top">
                    <td className="px-2 py-1 font-semibold">
                      <Link href={`/manage/${id}/shelf/${z.location_id}`} className="underline">
                        {z.locations?.code}
                      </Link>
                    </td>
                    <td className="px-2 py-1">{z.user_profiles?.full_name ?? '—'}</td>
                    <td className="px-2 py-1 text-ink-soft">{z.user_profiles?.email}</td>
                    <td
                      className={`px-2 py-1 ${z.status === 'done' ? 'text-match' : 'text-review'}`}
                    >
                      {z.status === 'done'
                        ? `✓ ${new Date(z.done_at ?? z.started_at).toLocaleString('ka-GE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' })}`
                        : 'ითვლება'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {zLines.get(z.location_id) ?? 0}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${zDiffs.get(z.location_id) ? 'font-semibold text-mismatch' : ''}`}
                    >
                      {zDiffs.get(z.location_id) ?? 0}
                    </td>
                    <td className="px-2 py-1 text-right">{zShots.get(z.location_id) ?? ''}</td>
                    <td className="px-2 py-1 text-ink-soft">{z.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <form action={setStocktakeStatus.bind(null, id, st.status === 'open' ? 'closed' : 'open')}>
          <button
            type="submit"
            className="rounded-full border border-rule-strong px-4 py-2 text-sm hover:bg-paper-sunk"
          >
            {st.status === 'open' ? '🔒 დახურვა' : '↺ ხელახლა გახსნა'}
          </button>
        </form>
        <form action={setStocktakeArchived.bind(null, id, !st.archived_at)}>
          <button
            type="submit"
            className="rounded-full border border-rule px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunk"
          >
            {st.archived_at ? '↩ არქივიდან დაბრუნება' : '🗄 არქივში გადატანა'}
          </button>
        </form>
      </div>
    </div>
  );
}
