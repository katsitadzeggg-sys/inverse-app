import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import NewStocktakeForm from './new-stocktake-form';

/** All stocktakes with their progress; open a new one. */
const TABS = [
  { kind: 'stock', label: '📦 მარაგები' },
  { kind: 'expiry', label: '⏳ ვადიანი' },
  { kind: 'assets', label: '🏷 ძირ. საშუალებები' },
];

export default async function ManageHome({ searchParams }: PageProps<'/manage'>) {
  await requireSession();
  const sp = await searchParams;
  const kind = typeof sp.kind === 'string' && ['stock', 'expiry', 'assets'].includes(sp.kind) ? sp.kind : 'stock';
  const supabase = await createClient();
  const { data } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<Stocktake[]>();
  const list = data ?? [];

  const { data: zones } = list.length
    ? await supabase.from('stocktake_zones').select('stocktake_id, status').in('stocktake_id', list.map((s) => s.id))
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
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <section className="grid content-start gap-3">
        <h1 className="text-xl font-semibold">ინვენტარიზაციები</h1>
        <nav className="flex flex-wrap gap-2 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.kind}
              href={`/manage?kind=${t.kind}`}
              className={`rounded-control border px-3 py-2 ${t.kind === kind ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {list.length === 0 && <p className="text-ink-soft">ჯერ არცერთი არ არის.</p>}
        <ul className="grid gap-2">
          {list.map((s) => {
            const p = progress.get(s.id) ?? { all: 0, done: 0 };
            return (
              <li key={s.id}>
                <Link href={`/manage/${s.id}`} className="grid gap-1 rounded-control border border-rule-strong px-4 py-3 hover:bg-paper-sunk">
                  <span className="flex justify-between text-sm text-ink-faint">
                    <span>{s.number} · {new Date(s.count_date).toLocaleDateString('ka-GE')}</span>
                    <span className={s.status === 'open' ? 'text-review' : 'text-match'}>{s.status === 'open' ? 'მიმდინარე' : 'დახურული'}</span>
                  </span>
                  <span className="text-lg font-semibold">{s.client_name ?? s.name}</span>
                  <span className="flex justify-between text-sm text-ink-soft">
                    <span>{s.branch}</span>
                    <span>თაროები: {p.done}/{p.all}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <NewStocktakeForm key={kind} kind={kind} />
    </div>
  );
}
