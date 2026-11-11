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
export default async function ManageHome({ searchParams }: PageProps<'/manage/stocktakes'>) {
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
  const archived = sp.archived === '1';
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
    };
  });
  // On top, in violet: what is still to count in each open stocktake.
  const leftRows: StRow[] = list
    .filter((s) => s.status === 'open' && Number(stats.get(s.id)?.left_qty ?? 0) > 0)
    .map((s) => {
      const t = stats.get(s.id)!;
      return {
        ...rows.find((r) => r.id === s.id)!,
        left: true,
        shelves: t.left_shelves,
        skus: t.left_skus,
        counted: Number(t.left_qty),
        plusQty: 0,
        plusSum: 0,
        minusQty: 0,
        minusSum: 0,
        diffSum: Number(t.left_sum),
      };
    });

  return (
    <div className="grid gap-6 rounded-2xl bg-paper-sunk p-5">
      <section className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((t) => (
            <Link
              key={t.kind}
              href={`/manage/stocktakes?kind=${t.kind}${archived ? '&archived=1' : ''}`}
              className={`rounded-control border px-3 py-2 text-sm font-medium ${
                t.kind === kind
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule-strong hover:bg-ink/5'
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
            className={`rounded-control border px-3 py-2 text-sm ${archived ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-ink-soft hover:bg-ink/5'}`}
          >
            🗄 არქივი
          </Link>
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
        </div>
        {list.length === 0 && <p className="text-ink-soft">ჯერ არცერთი არ არის.</p>}
        {list.length > 0 && <StocktakesGrid rows={rows} left={leftRows} />}
      </section>
    </div>
  );
}
