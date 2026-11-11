import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { setShowBook, setStocktakeArchived, setStocktakeStatus } from '@/app/(count)/count/actions';
import ExportBox from './export-box';
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

      {balance && (
        <section className="grid gap-2">
          {balance.lines.length ? (
            <div className="overflow-hidden rounded-md border border-[#c5ccd6]">
              <BalanceTable id={id} lines={balance.lines} hasCost={balance.hasCost} scroll />
            </div>
          ) : (
            <p className="text-sm text-ink-soft">ჯერ არაფერი დათვლილა.</p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={setStocktakeStatus.bind(null, id, st.status === 'open' ? 'closed' : 'open')}>
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-3 text-sm"
          >
            {st.status === 'open' ? '🔒 დახურვა' : '↺ ხელახლა გახსნა'}
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
