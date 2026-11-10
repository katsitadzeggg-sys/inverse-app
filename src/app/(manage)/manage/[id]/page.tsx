import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import {
  setShowBook,
  setStocktakeArchived,
  setStocktakeMembers,
  setStocktakeStatus,
} from '@/app/(count)/count/actions';
import ExportBox from './export-box';

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

  const [
    { data: zones },
    { data: entries },
    { data: checks },
    { data: media },
    { count: bookLines },
  ] = await Promise.all([
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
    supabase
      .from('stocktake_book')
      .select('id', { count: 'exact', head: true })
      .eq('stocktake_id', id),
  ]);
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

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link
          href={`/manage/stocktakes?kind=${st.kind}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <p className="text-sm text-ink-faint">
          {st.number} · {new Date(st.count_date).toLocaleDateString('ka-GE')} ·{' '}
          {st.kind === 'expiry'
            ? '⏳ ვადიანი პროდუქცია'
            : st.kind === 'assets'
              ? '🏷 ძირითადი საშუალებები'
              : '📦 მარაგები'}
        </p>
        <h1 className="text-2xl font-semibold">{st.client_name ?? st.name}</h1>
        {st.branch && <p className="text-ink-soft">{st.branch}</p>}
        {(st.address || st.lat != null) && (
          <p className="text-sm text-ink-soft">
            📍 {st.address ?? ''}{' '}
            {st.lat != null && st.lng != null && (
              <a
                href={mapsLink(st.lat, st.lng)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                რუკაზე
              </a>
            )}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <div className="rounded-control border border-rule/70 p-3">
          <p className="text-2xl font-semibold">
            {done}/{list.length}
          </p>
          თარო დასრულდა
        </div>
        {st.kind === 'assets' ? (
          <>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold">{foundCount ?? 0}</p>ჩაწერილი
            </div>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold">{regCount ?? 0}</p>რეესტრში
            </div>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold text-review">
                {Math.max(0, (regCount ?? 0) - (foundCount ?? 0))}
              </p>
              ჯერ ვერ ნაპოვნი
            </div>
          </>
        ) : (
          <>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold">{entries?.length ?? 0}</p>ჩანაწერი
            </div>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold text-mismatch">{checks?.length ?? 0}</p>სხვაობა
            </div>
            <div className="rounded-control border border-rule/70 p-3">
              <p className="text-2xl font-semibold">{bookLines ?? 0}</p>ხაზი ნაშთში
            </div>
          </>
        )}
      </div>

      {st.kind === 'assets' ? (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Link
            href={`/count/${id}/register`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            📄 რეესტრი
          </Link>
          <Link
            href={`/count/${id}/report`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            📊 შედეგი
          </Link>
          <Link
            href={`/count/${id}/labels`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            🏷 ეტიკეტები
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Link
            href={`/count/${id}/book`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            📄 ნაშთის ჩატვირთვა
          </Link>
          <Link
            href={`/count/${id}/report`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            {st.kind === 'expiry' ? '📊 სხვაობები და ვადები' : '📊 სხვაობები'}
          </Link>
          <Link
            href={`/manage/${id}/act`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            🖨 აქტი
          </Link>
          <Link
            href={`/count/${id}/labels`}
            className="rounded-control border border-rule-strong px-3 py-3 text-center"
          >
            🏷 ეტიკეტები
          </Link>
        </div>
      )}
      {st.kind !== 'assets' && (
        // Counters see the book quantity while counting (on), or count blind (off).
        <form
          action={setShowBook.bind(null, id, !st.show_book)}
          className="flex items-center justify-between gap-3 rounded-control border border-rule/70 px-4 py-3 text-sm"
        >
          <span>
            👁 აღმწერს ნაშთი უჩანს:{' '}
            <b className={st.show_book ? 'text-match' : 'text-ink-faint'}>
              {st.show_book ? 'კი' : 'არა (ბრმა დათვლა)'}
            </b>
          </span>
          <button type="submit" className="rounded-control border border-rule-strong px-3 py-1.5">
            {st.show_book ? 'დამალვა' : 'ჩვენება'}
          </button>
        </form>
      )}

      <Link
        href={`/manage/${id}/map`}
        className="rounded-control border-2 border-rule-strong px-3 py-3 text-center text-sm font-semibold"
      >
        🗺 რუკა — რომელი თარო დაითვალა, სად არის სხვაობა
      </Link>

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
          <div className="overflow-x-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left text-xs text-ink-faint">
                <tr>
                  <th className="p-2">თარო</th>
                  <th className="p-2">აღმწერი</th>
                  <th className="p-2">სტატუსი</th>
                  <th className="p-2 text-right">ჩანაწ.</th>
                  <th className="p-2 text-right">სხვაობა</th>
                  <th className="p-2">📷</th>
                  <th className="p-2">📍</th>
                  <th className="p-2">კომენტარი</th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => (
                  <tr key={z.id} className="border-t border-rule/60 align-top">
                    <td className="p-2 font-semibold">
                      <Link href={`/count/${id}/${z.location_id}/done`} className="underline">
                        {z.locations?.code}
                      </Link>
                    </td>
                    <td className="p-2">{z.user_profiles?.full_name ?? z.user_profiles?.email}</td>
                    <td className={`p-2 ${z.status === 'done' ? 'text-match' : 'text-review'}`}>
                      {z.status === 'done'
                        ? `✓ ${new Date(z.done_at ?? z.started_at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })}`
                        : 'ითვლება'}
                    </td>
                    <td className="p-2 text-right tabular-nums">{lines.get(z.location_id) ?? 0}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${diffs.get(z.location_id) ? 'font-semibold text-mismatch' : ''}`}
                    >
                      {diffs.get(z.location_id) ?? 0}
                    </td>
                    <td className="p-2">{shots.get(z.location_id) ?? ''}</td>
                    <td className="p-2">
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
                    <td className="p-2 text-ink-soft">{z.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-2 rounded-control border border-rule/70 p-4">
        <h2 className="font-semibold">👷 აღმწერები ამ ინვენტარიზაციაზე</h2>
        {counters.length === 0 ? (
          <p className="text-sm text-ink-soft">
            გუნდში აღმწერი ჯერ არ არის —{' '}
            <Link href="/manage/sites#team" className="underline">
              მოიწვიე
            </Link>
            .
          </p>
        ) : (
          <form action={setStocktakeMembers.bind(null, id)} className="grid gap-2">
            {counters.map((m) => (
              <label key={m.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="member"
                  value={m.id}
                  defaultChecked={ticked.has(m.id)}
                  className="h-5 w-5"
                />
                <span>
                  {m.full_name ?? m.email} <span className="text-ink-faint">· {m.email}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-ink-faint">
              {ticked.size
                ? `დანიშნულია ${ticked.size}. სხვა აღმწერები ამ ინვენტარიზაციას ვერ დაინახავენ.`
                : 'არავინ არ არის მონიშნული — ხედავს ყველა აღმწერი.'}
            </p>
            <button
              type="submit"
              className="justify-self-start rounded-control border border-rule-strong px-4 py-2 text-sm font-semibold"
            >
              შენახვა
            </button>
          </form>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <form action={setStocktakeStatus.bind(null, id, st.status === 'open' ? 'closed' : 'open')}>
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-3 text-sm"
          >
            {st.status === 'open' ? '🔒 ინვენტარიზაციის დახურვა' : '↺ ხელახლა გახსნა'}
          </button>
        </form>
        <form action={setStocktakeArchived.bind(null, id, !st.archived_at)}>
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-3 text-sm text-ink-soft"
          >
            {st.archived_at ? '↩ არქივიდან დაბრუნება' : '🗄 არქივში გადატანა'}
          </button>
        </form>
      </div>
    </div>
  );
}
