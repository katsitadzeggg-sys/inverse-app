import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import StocktakesGrid, { type StRow } from './stocktakes-grid';
import AddDrawer from '@/components/add-drawer';
import NewStocktakeForm from '../new-stocktake-form';

const KINDS = [
  { kind: 'all', label: 'ყველა' },
  { kind: 'stock', label: '📦 მარაგები' },
  { kind: 'expiry', label: '⏳ ვადიანი' },
  { kind: 'assets', label: '🏷 ძირ. საშუალებები' },
];

/** Every stocktake — stock, expiry, fixed assets — on one page, with a filter and "+ new". */
export default async function StocktakesView({
  searchParams,
  archived,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** The archive tab: archived stocktakes, no "+". */
  archived: boolean;
}) {
  const { company } = await requireSession();
  const sp = await searchParams;
  // The top bar's search: number, client, branch or name, across every kind.
  const q =
    typeof sp.q === 'string'
      ? sp.q
          .trim()
          .replace(/[,()%*]/g, ' ')
          .trim()
      : '';
  const kind =
    typeof sp.kind === 'string' && ['stock', 'expiry', 'assets', 'all'].includes(sp.kind)
      ? sp.kind
      : q
        ? 'all'
        : 'stock';
  const base_ = archived ? '/manage/archive' : '/manage/stocktakes';
  const supabase = await createClient();
  const all = supabase.from('stocktakes').select('*');
  const kinded = kind === 'all' ? all : all.eq('kind', kind);
  const base = q
    ? kinded.or(
        ['number', 'client_name', 'branch', 'name'].map((c) => `${c}.ilike.%${q}%`).join(','),
      )
    : kinded;
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
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, address, lat, lng')
    .order('name')
    .returns<
      { id: string; name: string; address: string | null; lat: number | null; lng: number | null }[]
    >();
  const rows: StRow[] = list.map((s) => {
    const t = stats.get(s.id);
    return {
      id: s.id,
      kind: s.kind,
      number: s.number,
      opened: s.created_at,
      closed: s.closed_at,
      warehouse: s.branch || s.client_name || s.name,
      shelves: t?.shelves ?? 0,
      shelvesDone: t?.shelves_done ?? 0,
      skus: t?.skus ?? 0,
      counted: Number(t?.counted_qty ?? 0),
      plusQty: Number(t?.plus_qty ?? 0),
      plusSum: Number(t?.plus_sum ?? 0),
      plusNocost: t?.plus_nocost ?? 0,
      minusQty: Number(t?.minus_qty ?? 0),
      minusSum: Number(t?.minus_sum ?? 0),
      diffSum: Number(t?.plus_sum ?? 0) - Number(t?.minus_sum ?? 0),
      status: s.status === 'open' ? 'open' : 'closed',
      formKind: s.form_kind,
    };
  });
  // On top, two pinned rows per warehouse:
  // "გამორჩენილი" (violet) — in the balance, counted in none of its stocktakes;
  // "გადასამოწმებელი" (amber) — counted, but the total over all of them differs.
  const blank: StRow = {
    id: '',
    kind: '',
    number: '',
    opened: '',
    closed: null,
    warehouse: '',
    shelves: 0,
    shelvesDone: 0,
    skus: 0,
    counted: 0,
    plusQty: 0,
    plusSum: 0,
    plusNocost: 0,
    minusQty: 0,
    minusSum: 0,
    diffSum: 0,
    status: 'open',
  };
  // The stocktakes of one warehouse are one count: book once, counts summed.
  type Pool = {
    missed_skus: number;
    missed_qty: number;
    missed_sum: number;
    review_skus: number;
    plus_qty: number;
    plus_sum: number;
    minus_qty: number;
    minus_sum: number;
    zeroed_skus: number;
    moved_skus: number;
  };
  const wh = (s: Stocktake) => s.branch || s.client_name || s.name;
  const groups = new Map<string, string[]>();
  for (const s of list)
    if (s.kind !== 'assets') groups.set(wh(s), [...(groups.get(wh(s)) ?? []), s.id]);
  const pools = await Promise.all(
    [...groups].map(async ([name, ids]) => {
      const { data: r } = await supabase.rpc('stocktake_pool_stats', { p_ids: ids });
      return { name, ids, p: ((r ?? []) as Pool[])[0] };
    }),
  );
  const pinned: StRow[] = [];
  for (const { name, ids, p } of pools) {
    if (!p) continue;
    const label = `${name} · ${ids.length} ინვ.`;
    if (Number(p.missed_skus) > 0)
      pinned.push({
        ...blank,
        id: `missed-${name}`,
        warehouse: label,
        left: true,
        ids,
        skus: Number(p.missed_skus),
        counted: Number(p.missed_qty),
        diffSum: Number(p.missed_sum),
      });
    if (Number(p.review_skus) > 0)
      pinned.push({
        ...blank,
        id: `review-${name}`,
        warehouse: label,
        review: true,
        ids,
        zeroed: Number(p.zeroed_skus),
        moved: Number(p.moved_skus),
        skus: Number(p.review_skus),
        plusQty: Number(p.plus_qty),
        plusSum: Number(p.plus_sum),
        minusQty: Number(p.minus_qty),
        minusSum: Number(p.minus_sum),
        diffSum: Number(p.plus_sum) - Number(p.minus_sum),
      });
  }

  return (
    <div className="grid gap-6 rounded-2xl bg-paper-sunk p-5">
      <section className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((t) => (
            <Link
              key={t.kind}
              href={`${base_}?kind=${t.kind}`}
              className={`rounded-control border px-3 py-2 text-sm font-medium ${
                t.kind === kind
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule-strong hover:bg-ink/5'
              }`}
            >
              {t.label}
            </Link>
          ))}
          {!archived && (
            <div className="ml-auto">
              {/* "+" on the right above the table: a new stocktake, in a drawer. */}
              <AddDrawer title="ახალი ინვენტარიზაცია" label="ახალი" startOpen={sp.add === '1'}>
                <NewStocktakeForm
                  kind={kind === 'all' ? 'stock' : kind}
                  companyName={company.name}
                  sites={sites ?? []}
                />
              </AddDrawer>
            </div>
          )}
        </div>
        {list.length === 0 && <p className="text-ink-soft">ჯერ არცერთი არ არის.</p>}
        {list.length > 0 && <StocktakesGrid rows={rows} left={pinned} />}
      </section>
    </div>
  );
}
