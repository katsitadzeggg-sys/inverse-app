import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { setShowBook, setStocktakeArchived, setStocktakeStatus } from '@/app/(count)/count/actions';
import ExportBox from './export-box';
import MembersForm from './members-form';
import BalanceTable from './balance-table';
import { stockActData } from '@/lib/stock-act';

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
  await requireSession();
  const supabase = await createClient();

  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();

  const [{ data: zones }, { data: entries }, { data: checks }, { data: media }] = await Promise.all(
    [
      supabase
        .from('stocktake_zones')
        .select('*, locations (code), user_profiles (full_name, email)')
        .eq('stocktake_id', id)
        .order('started_at')
        .returns<ZoneRow[]>(),
      supabase
        .from('stocktake_entries')
        .select('location_id')
        .eq('stocktake_id', id)
        .limit(20000)
        .returns<{ location_id: string }[]>(),
      supabase
        .from('stocktake_checks')
        .select('location_id, status')
        .eq('stocktake_id', id)
        .neq('status', 'ok')
        .returns<{ location_id: string; status: string }[]>(),
      supabase
        .from('stocktake_media')
        .select('location_id')
        .eq('stocktake_id', id)
        .returns<{ location_id: string }[]>(),
    ],
  );
  const count = (rows: { location_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.location_id, (m.get(r.location_id) ?? 0) + 1);
    return m;
  };
  const lines = count(entries);
  const diffs = count(checks);
  const shots = count(media);
  const list = zones ?? [];
  // Who may count here: the team (without the disabled) and who is ticked.
  const [{ data: team }, { data: assigned }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id, full_name, email, role')
      .is('disabled_at', null)
      .order('created_at')
      .returns<{ id: string; full_name: string | null; email: string; role: string }[]>(),
    supabase
      .from('stocktake_members')
      .select('user_id')
      .eq('stocktake_id', id)
      .returns<{ user_id: string }[]>(),
  ]);
  const ticked = new Set((assigned ?? []).map((a) => a.user_id));
  // Who pressed "🏁 I'm done" and who is still counting.
  const { data: fin } = await supabase
    .from('stocktake_finished')
    .select('user_id, finished_at')
    .eq('stocktake_id', id)
    .not('finished_at', 'is', null)
    .returns<{ user_id: string; finished_at: string }[]>();
  const finished = new Map((fin ?? []).map((f) => [f.user_id, f.finished_at]));
  const working = [...new Set(list.map((z) => z.counter_id).filter(Boolean))] as string[];
  const nameOf = (uid: string) => {
    const m = (team ?? []).find((t) => t.id === uid);
    const z = list.find((x) => x.counter_id === uid)?.user_profiles;
    return m?.full_name ?? m?.email ?? z?.full_name ?? z?.email ?? '—';
  };
  const when = (t: string) =>
    new Date(t).toLocaleString('ka-GE', { dateStyle: 'short', timeStyle: 'short' });
  const counters = (team ?? []).filter(
    (m) => m.role !== 'owner' && m.role !== 'admin' && m.role !== 'viewer',
  );
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
  const balance =
    st.kind === 'assets'
      ? null
      : await stockActData(supabase, id).then((d) => ({
          hasCost: d.hasCost,
          lines: d.lines
            .filter((l) => l.shelves.length > 0 || l.counted !== 0)
            .map((l, i) => ({ ...l, n: i + 1 })),
        }));

  // Action buttons: raised orange keys, clearly different from the faded info tiles.
  const btn =
    'rounded-lg border border-[#9a3412] border-b-4 bg-gradient-to-b from-[#fb923c] to-[#ea580c] px-3 py-2.5 text-center font-semibold text-white shadow-md transition hover:brightness-110 active:translate-y-px active:border-b-2';
  const tile = 'rounded-control border border-white/10 bg-white/[0.04] p-2 opacity-75';

  return (
    <div className="grid gap-3">
      {/* One line: back · number · date · kind · client · branch · address · book switch */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/manage/stocktakes?kind=${st.kind}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-3 py-1.5 text-sm font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <span className="text-sm text-ink-faint">
          {st.number} · {new Date(st.count_date).toLocaleDateString('ka-GE')} ·{' '}
          {st.kind === 'expiry' ? '⏳' : st.kind === 'assets' ? '🏷' : '📦'}
        </span>
        <h1 className="text-xl font-semibold">
          {st.client_name ?? st.name}
          {st.branch && <span className="font-normal text-ink-soft"> · {st.branch}</span>}
        </h1>
        {(st.address || st.lat != null) && (
          <span className="text-sm text-ink-soft">
            📍{' '}
            {st.lat != null && st.lng != null ? (
              <a
                href={mapsLink(st.lat, st.lng)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {st.address || 'რუკაზე'}
              </a>
            ) : (
              st.address
            )}
          </span>
        )}
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
              className="flex items-center gap-2 text-sm"
            >
              👁 აღწერის თანამშრომელს ნაშთი უჩანს
              <span
                className={`relative inline-block h-6 w-11 rounded-full transition ${st.show_book ? 'bg-[#16a34a]' : 'bg-[#dc2626]'}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${st.show_book ? 'left-[22px]' : 'left-0.5'}`}
                />
              </span>
              <b className={st.show_book ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                {st.show_book ? 'კი' : 'არა'}
              </b>
            </button>
          </form>
        )}
      </div>

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
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Link href={`/count/${id}/register`} className={btn}>
            📄 რეესტრი
          </Link>
          <Link href={`/count/${id}/report`} className={btn}>
            📊 შედეგი
          </Link>
          <Link href={`/count/${id}/labels`} className={btn}>
            🏷 ეტიკეტები
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Link href={`/count/${id}/book`} className={btn}>
            📄 ნაშთი
          </Link>
          <Link href={`/count/${id}/report`} className={btn}>
            {st.kind === 'expiry' ? '📊 სხვაობები / ვადები' : '📊 სხვაობები'}
          </Link>
          <Link href={`/manage/${id}/act`} className={btn}>
            🖨 აქტი
          </Link>
          <Link href={`/count/${id}/labels`} className={btn}>
            🏷 ეტიკეტები
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

      <section className="grid gap-2">
        <h2 className="font-semibold">თაროები</h2>
        {list.length === 0 ? (
          <p className="text-sm text-ink-soft">ჯერ არცერთი თარო არ გახსნილა.</p>
        ) : (
          <div className="max-h-[45vh] overflow-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-paper-sunk text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-2 py-1">თარო</th>
                  <th className="px-2 py-1">აღწერის თანამშრომელი</th>
                  <th className="px-2 py-1">სტატუსი</th>
                  <th className="px-2 py-1 text-right">ჩანაწ.</th>
                  <th className="px-2 py-1 text-right">სხვაობა</th>
                  <th className="px-2 py-1">📷</th>
                  <th className="px-2 py-1">📍</th>
                  <th className="px-2 py-1">კომენტარი</th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => (
                  <tr key={z.id} className="border-t border-rule/60 align-top">
                    <td className="px-2 py-1 font-semibold">
                      <Link href={`/count/${id}/${z.location_id}/done`} className="underline">
                        {z.locations?.code}
                      </Link>
                    </td>
                    <td className="px-2 py-1">
                      {z.user_profiles?.full_name ?? z.user_profiles?.email}
                    </td>
                    <td
                      className={`px-2 py-1 ${z.status === 'done' ? 'text-match' : 'text-review'}`}
                    >
                      {z.status === 'done'
                        ? `✓ ${new Date(z.done_at ?? z.started_at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })}`
                        : 'ითვლება'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {lines.get(z.location_id) ?? 0}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${diffs.get(z.location_id) ? 'font-semibold text-mismatch' : ''}`}
                    >
                      {diffs.get(z.location_id) ?? 0}
                    </td>
                    <td className="px-2 py-1">{shots.get(z.location_id) ?? ''}</td>
                    <td className="px-2 py-1">
                      {z.lat != null && z.lng != null ? (
                        <a
                          href={mapsLink(z.lat, z.lng)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          რუკა
                        </a>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="px-2 py-1 text-ink-soft">{z.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {balance && (
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-x-3">
            <h2 className="font-semibold">📒 დათვლილი — ბალანსის ფორმით</h2>
            <span className="text-sm text-ink-faint">
              {balance.lines.length} პოზიცია · სრული აქტი ნაშთის ყველა ხაზით —{' '}
              <Link href={`/manage/${id}/act`} className="underline">
                🖨 აქტი
              </Link>
            </span>
          </div>
          {balance.lines.length ? (
            <div className="overflow-hidden rounded-md border border-[#c5ccd6]">
              <BalanceTable id={id} lines={balance.lines} hasCost={balance.hasCost} scroll />
            </div>
          ) : (
            <p className="text-sm text-ink-soft">ჯერ არაფერი დათვლილა.</p>
          )}
        </section>
      )}

      <section className="grid gap-2 rounded-control border border-rule/70 p-3">
        <h2 className="font-semibold">👷 აღწერის თანამშრომლები</h2>
        {working.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {working.map((uid) => (
              <li key={uid} className="flex flex-wrap items-center justify-between gap-2">
                <span>{nameOf(uid)}</span>
                {finished.has(uid) ? (
                  <span className="text-match">🏁 დაასრულა · {when(finished.get(uid)!)}</span>
                ) : (
                  <span className="text-review">ითვლის…</span>
                )}
              </li>
            ))}
            <li className="text-xs text-ink-faint">
              დაასრულა {working.filter((u) => finished.has(u)).length} / {working.length}
            </li>
          </ul>
        )}
        {counters.length === 0 ? (
          <p className="text-sm text-ink-soft">
            გუნდში აღწერის თანამშრომელი ჯერ არ არის —{' '}
            <Link href="/manage/sites#team" className="underline">
              მოიწვიე
            </Link>
            .
          </p>
        ) : (
          <MembersForm stocktakeId={id} counters={counters} ticked={[...ticked]} />
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <form action={setStocktakeStatus.bind(null, id, st.status === 'open' ? 'closed' : 'open')}>
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-3 text-sm"
          >
            {st.status === 'open'
              ? '🔒 დახურვა — დათვლა დასრულდა'
              : '↺ ხელახლა გახსნა — დათვლის გაგრძელება'}
          </button>
        </form>
        <form action={setStocktakeArchived.bind(null, id, !st.archived_at)}>
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-3 text-sm text-ink-soft"
          >
            {st.archived_at ? '↩ არქივიდან დაბრუნება' : '🗄 არქივში — სიიდან მოშორება'}
          </button>
        </form>
      </div>
    </div>
  );
}
