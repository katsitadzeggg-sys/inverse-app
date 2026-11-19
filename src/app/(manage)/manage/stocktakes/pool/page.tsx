import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { allPoolLines } from '@/lib/pool-lines';
import { unitWord } from '@/lib/stock-act';
import PoolGrid, { type PoolRow } from './pool-grid';
import FormButton from './form-button';

export const metadata = { title: 'გამორჩენილი / გადასამოწმებელი' };

const CHUNK = 400;

/**
 * A warehouse's missed (in the balance, counted nowhere) or to-re-check
 * products, read-only: what they are, where the balance puts them, how many
 * and for how much. Making a form to count them is a separate button.
 */
export default async function PoolPage({ searchParams }: PageProps<'/manage/stocktakes/pool'>) {
  const sp = await searchParams;
  const kind = sp.kind === 'review' ? 'review' : 'missed';
  const ids = String(sp.ids ?? '')
    .split(',')
    .filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) notFound();
  await requireSession();
  const supabase = await createClient();

  const { data: sts } = await supabase
    .from('stocktakes')
    .select('id, number, branch, client_name, name, created_at, form_kind')
    .in('id', ids)
    .order('created_at', { ascending: false })
    .returns<
      {
        id: string;
        number: string;
        branch: string | null;
        client_name: string | null;
        name: string;
        created_at: string;
        form_kind: string | null;
      }[]
    >();
  if (!sts?.length) notFound();
  const warehouse = sts[0].branch ?? sts[0].client_name ?? sts[0].name;

  const lines = (await allPoolLines(supabase, ids)).filter((l) => l.status === kind);
  const pids = lines.map((l) => l.product_id);

  // Names and codes.
  const info = new Map<string, { name: string; code: string; unit: string }>();
  for (let i = 0; i < pids.length; i += CHUNK) {
    const { data } = await supabase
      .from('products')
      .select('id, name, barcode, sku, unit')
      .in('id', pids.slice(i, i + CHUNK));
    for (const p of data ?? [])
      info.set(p.id as string, {
        name: p.name as string,
        code: (p.barcode as string | null) ?? (p.sku as string),
        unit: unitWord(p.unit as string | null),
      });
  }
  // Where the balance puts them (shelf codes), from the warehouse's stocktakes.
  const where = new Map<string, Set<string>>();
  const real = sts.filter((s) => !s.form_kind).map((s) => s.id);
  for (let i = 0; i < pids.length; i += CHUNK) {
    const { data } = await supabase
      .from('stocktake_book')
      .select('product_id, locations (code)')
      .in('stocktake_id', real.length ? real : ids)
      .in('product_id', pids.slice(i, i + CHUNK))
      .limit(10000)
      .returns<{ product_id: string; locations: { code: string } | null }[]>();
    for (const b of data ?? [])
      if (b.locations?.code)
        where.set(b.product_id, (where.get(b.product_id) ?? new Set()).add(b.locations.code));
  }

  const rows: PoolRow[] = lines
    .map((l) => {
      const p = info.get(l.product_id);
      const book = Number(l.cur_qty);
      const counted = l.counted_qty == null ? null : Number(l.counted_qty);
      const ref = l.ref_qty == null ? book : Number(l.ref_qty);
      const diff = kind === 'missed' ? -book : (counted ?? 0) - ref;
      return {
        id: l.product_id,
        name: p?.name ?? '—',
        code: p?.code ?? '',
        unit: p?.unit ?? '',
        shelf: [...(where.get(l.product_id) ?? [])]
          .sort((a, b) => a.localeCompare(b, 'ka', { numeric: true }))
          .join(', '),
        book: kind === 'missed' ? book : ref,
        counted,
        diff,
        price: Number(l.price),
        sum: diff * Number(l.price),
        why: l.zeroed
          ? 'ნაშთიდან გაქრა, არ დათვლილა'
          : l.moved
            ? 'დათვლის დღეს ნაშთი შეიცვალა'
            : '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ka'));

  const total = rows.reduce((a, r) => a + r.sum, 0);
  const missed = kind === 'missed';
  return (
    <div className="grid gap-3 rounded-2xl bg-paper-sunk p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/manage/stocktakes?kind=stock"
          className="rounded-control border border-rule-strong px-3 py-1.5 text-sm font-medium"
        >
          ← დაბრუნება
        </Link>
        <h1 className={`text-xl font-semibold ${missed ? 'text-[#5b21b6]' : 'text-[#b45309]'}`}>
          {missed ? '⏳ გამორჩენილი' : '🔎 გადასამოწმებელი'} · {warehouse}
        </h1>
        <span className="text-sm text-ink-soft">
          {rows.length} პროდუქტი · {Math.round(total).toLocaleString('ka-GE')} ₾ · {sts.length}{' '}
          ინვენტარიზაცია
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Link
            href={`/manage/${ids[0]}/map?view=3d&focus=${kind}`}
            className="rounded-full border border-rule-strong px-3 py-1.5 text-sm font-medium"
          >
            🗺 რუკაზე
          </Link>
          <FormButton ids={ids} kind={kind} />
        </span>
      </div>
      <p className="text-xs text-ink-soft">
        {missed
          ? 'ნაშთშია, მაგრამ ამ საწყობის არცერთ აღწერაში არ დაითვალა. სანახავად — აქ არაფერი იქმნება; დასათვლელად „ფორმის შექმნა“.'
          : 'დათვლილია, მაგრამ ჯამი ნაშთს არ ემთხვევა ან დათვლის დღეს ნაშთი შეიცვალა.'}
      </p>
      <PoolGrid rows={rows} missed={missed} fileName={`${warehouse}-${kind}`} />
    </div>
  );
}
