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
  const { data: zones } = list.length
    ? await supabase
        .from('stocktake_zones')
        .select('stocktake_id, status')
        .in(
          'stocktake_id',
          list.map((s) => s.id),
        )
        .returns<{ stocktake_id: string; status: string }[]>()
    : { data: [] as { stocktake_id: string; status: string }[] };
  const progress = new Map<string, { all: number; done: number }>();
  for (const z of zones ?? []) {
    const p = progress.get(z.stocktake_id) ?? { all: 0, done: 0 };
    p.all += 1;
    if (z.status === 'done') p.done += 1;
    progress.set(z.stocktake_id, p);
  }

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
        <ul className="grid gap-1">
          {list.map((s) => {
            const p = progress.get(s.id) ?? { all: 0, done: 0 };
            return (
              <li key={s.id}>
                {/* One compact line per stocktake. */}
                <Link
                  href={`/manage/${s.id}`}
                  className="flex min-w-0 items-center gap-x-3 rounded-control border border-rule/60 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  <span className="shrink-0" title={KIND_LABEL[s.kind]}>
                    {KIND_LABEL[s.kind].split(' ')[0]}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{s.number}</span>
                  <span className="hidden shrink-0 tabular-nums text-ink-faint sm:inline">
                    {new Date(s.count_date).toLocaleDateString('ka-GE')}
                  </span>
                  <span className="min-w-0 truncate font-semibold">
                    {s.client_name ?? s.name}
                    {s.branch && <span className="font-normal text-ink-soft"> · {s.branch}</span>}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink-soft">
                    {p.done}/{p.all}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${s.status === 'open' ? 'text-review' : 'text-match'}`}
                  >
                    {s.status === 'open' ? '● მიმდინარე' : '✓ დახურული'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
