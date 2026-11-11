import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';

const KINDS = [
  { kind: 'all', label: 'ყველა' },
  { kind: 'stock', label: '📦 მარაგები' },
  { kind: 'expiry', label: '⏳ ვადიანი' },
  { kind: 'assets', label: '🏷 ძირ. საშუალებები' },
];
const KIND_LABEL: Record<string, string> = {
  stock: '📦 მარაგები',
  expiry: '⏳ ვადიანი',
  assets: '🏷 ძირ. საშუალებები',
};

/** Every stocktake — stock, expiry, fixed assets — on one page, with a filter and "+ new". */
export default async function ManageHome({ searchParams }: PageProps<'/manage/stocktakes'>) {
  await requireSession();
  const sp = await searchParams;
  const kind =
    typeof sp.kind === 'string' && ['stock', 'expiry', 'assets'].includes(sp.kind)
      ? sp.kind
      : 'stock';
  const archived = sp.archived === '1';
  const supabase = await createClient();
  const all = supabase.from('stocktakes').select('*');
  const base = kind === 'all' ? all : all.eq('kind', kind);
  const { data } = await (
    archived ? base.not('archived_at', 'is', null) : base.is('archived_at', null)
  )
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<Stocktake[]>();
  const list = data ?? [];
  type Stats = {
    stocktake_id: string;
    shelves: number;
    shelves_done: number;
    skus: number;
    counted_qty: number;
    plus_nocost: number;
    left_qty: number;
    left_sum: number;
    left_shelves: number;
    left_skus: number;
    plus_qty: number;
    plus_sum: number;
    minus_qty: number;
    minus_sum: number;
  };
  const { data: statRows } = list.length
    ? await supabase.rpc('stocktake_stats4', { p_ids: list.map((s) => s.id) })
    : { data: [] };
  const stats = new Map(((statRows ?? []) as Stats[]).map((r) => [r.stocktake_id, r]));
  const n = (v: number) => Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 2 });
  const gel = (v: number) => `${Number(v).toLocaleString('ka-GE', { maximumFractionDigits: 0 })} ₾`;
  const when = (t: string) =>
    new Date(t).toLocaleString('ka-GE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tbilisi',
    });
  const hour = (t: string) =>
    new Date(t).toLocaleTimeString('ka-GE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tbilisi',
    });
  const day = (t: string) => new Date(t).toLocaleDateString('ka-GE', { timeZone: 'Asia/Tbilisi' });
  // Same columns for the header and every row.
  const cols =
    'grid grid-cols-[1.5rem_7.5rem_10rem_minmax(7rem,1fr)_3rem_3.5rem_4.5rem_8rem_8rem_6.5rem_6.5rem] items-center gap-x-2';

  return (
    <div className="grid gap-6">
      <section className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((t) => (
            <Link
              key={t.kind}
              href={`/manage/stocktakes?kind=${t.kind}${archived ? '&archived=1' : ''}`}
              className={`rounded-control border px-3 py-2 text-sm font-medium ${
                t.kind === kind
                  ? 'border-white bg-white text-paper'
                  : 'border-rule-strong hover:bg-white/10'
              }`}
            >
              {t.label}
            </Link>
          ))}
          <Link
            href={
              archived
                ? `/manage/stocktakes?kind=${kind}`
                : `/manage/stocktakes?kind=${kind}&archived=1`
            }
            className={`rounded-control border px-3 py-2 text-sm ${archived ? 'border-white bg-white text-paper' : 'border-rule-strong text-ink-soft hover:bg-white/10'}`}
          >
            🗄 არქივი
          </Link>
          <Link
            href={`/manage/new${kind !== 'all' ? `?kind=${kind}` : ''}`}
            className="ml-auto rounded-control bg-accent px-4 py-2 text-sm font-semibold text-paper"
          >
            + ახალი ინვენტარიზაცია
          </Link>
        </div>
        {list.length === 0 && <p className="text-ink-soft">ჯერ არცერთი არ არის.</p>}
        {list.length > 0 && (
          <div className="overflow-x-auto">
            <div className="grid min-w-[1050px] gap-1">
              <div className={`${cols} px-3 text-xs text-ink-faint`}>
                <span />
                <span>ინვენტარიზაციის N</span>
                <span>გაიხსნა → დაიხურა</span>
                <span>საწყობი</span>
                <span className="text-right">თარო</span>
                <span className="text-right">SKU</span>
                <span className="text-right">პროდუქტი</span>
                <span className="text-right">მეტობა რაოდ. / ₾</span>
                <span className="text-right">დანაკლისი რაოდ. / ₾</span>
                <span className="text-right">სხვაობა ₾</span>
                <span className="text-right">სტატუსი</span>
              </div>
              {/* On top, in violet: what is still to count — the book on shelves
                  not closed yet, per open stocktake. Shrinks as shelves close. */}
              {list
                .filter((s) => s.status === 'open' && (stats.get(s.id)?.left_qty ?? 0) > 0)
                .map((s) => {
                  const t = stats.get(s.id)!;
                  return (
                    <Link
                      key={`left-${s.id}`}
                      href={`/manage/${s.id}`}
                      className={`${cols} rounded-control border border-[#a78bfa]/60 bg-[#7c3aed]/15 px-3 py-1.5 text-sm tabular-nums text-[#ddd6fe] hover:bg-[#7c3aed]/25`}
                    >
                      <span>⏳</span>
                      <span className="font-semibold">დარჩენილი</span>
                      <span className="text-[#c4b5fd]">{s.number}</span>
                      <span className="min-w-0 truncate font-semibold">
                        {s.branch || s.client_name || s.name}
                      </span>
                      <span className="text-right" title="თაროები, რომლებიც ჯერ არ დახურულა">
                        {t.left_shelves}
                      </span>
                      <span className="text-right">{t.left_skus}</span>
                      <span className="text-right">{n(t.left_qty)}</span>
                      <span className="text-right">—</span>
                      <span className="text-right">—</span>
                      <span className="text-right font-semibold">{gel(t.left_sum)}</span>
                      <span className="text-right text-xs">დასათვლელი</span>
                    </Link>
                  );
                })}
              {list.map((s) => {
                const t = stats.get(s.id);
                const diffSum = (t?.plus_sum ?? 0) - (t?.minus_sum ?? 0);
                return (
                  <Link
                    key={s.id}
                    href={`/manage/${s.id}`}
                    className={`${cols} rounded-control border border-rule/60 px-3 py-1.5 text-sm tabular-nums hover:bg-white/10`}
                  >
                    <span title={KIND_LABEL[s.kind]}>{KIND_LABEL[s.kind].split(' ')[0]}</span>
                    <span className="text-ink-faint">{s.number}</span>
                    <span className="text-ink-faint">
                      {/* Opened (day and hour) → closed (hour, or day too if another day). */}
                      {when(s.created_at)}
                      {s.closed_at && (
                        <span className="text-ink-soft">
                          {' → '}
                          {day(s.closed_at) === day(s.created_at)
                            ? hour(s.closed_at)
                            : when(s.closed_at)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 truncate font-semibold">
                      {s.branch || s.client_name || s.name}
                    </span>
                    <span
                      className="text-right"
                      title={`დასრულებული ${t?.shelves_done ?? 0} / ${t?.shelves ?? 0}`}
                    >
                      {t?.shelves ?? 0}
                    </span>
                    <span className="text-right">{t?.skus ?? 0}</span>
                    <span className="text-right">{n(t?.counted_qty ?? 0)}</span>
                    <span
                      className="text-right text-[#60a5fa]"
                      title={
                        t?.plus_nocost
                          ? `${t.plus_nocost} პროდუქტს ფასი არ აქვს — თანხაში არ ითვლება`
                          : undefined
                      }
                    >
                      {t?.plus_qty
                        ? `+${n(t.plus_qty)} / ${gel(t.plus_sum)}${t.plus_nocost ? ' *' : ''}`
                        : '—'}
                    </span>
                    <span className="text-right text-[#f87171]">
                      {t?.minus_qty ? `−${n(t.minus_qty)} / ${gel(t.minus_sum)}` : '—'}
                    </span>
                    <span
                      className={`text-right font-semibold ${diffSum < 0 ? 'text-[#f87171]' : diffSum > 0 ? 'text-[#60a5fa]' : 'text-ink-faint'}`}
                    >
                      {t?.plus_qty || t?.minus_qty ? gel(diffSum) : '—'}
                    </span>
                    <span
                      className={`text-right text-xs ${s.status === 'open' ? 'text-review' : 'text-match'}`}
                    >
                      {s.status === 'open' ? '● მიმდინარე' : '✓ დახურული'}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
