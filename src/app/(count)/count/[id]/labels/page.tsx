import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import type { LabelData } from '@/lib/zebra';
import ZebraPanel from './zebra-panel';

type Src = 'shelves' | 'products' | 'assets';

async function pages<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Labels for the Zebra ZQ511 (or paper): shelf QR codes, product barcodes,
 * inventory numbers with QR + barcode. Size is picked on the page.
 */
export default async function LabelsPage({
  params,
  searchParams,
}: PageProps<'/count/[id]/labels'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();
  const isAssets = st.kind === 'assets';
  const src: Src =
    sp.src === 'shelves' || sp.src === 'products' || sp.src === 'assets'
      ? sp.src
      : isAssets
        ? 'assets'
        : 'shelves';
  const all = sp.all === '1';
  const owner = st.client_name ?? st.name;
  let items: LabelData[] = [];
  let note = '';

  if (src === 'assets') {
    const rows = all
      ? await pages<{ inv_no: string; name: string }>((a, b) =>
          supabase
            .from('asset_register')
            .select('inv_no, name')
            .eq('stocktake_id', id)
            .order('inv_no')
            .range(a, b),
        )
      : await pages<{ inv_no: string; name: string }>((a, b) =>
          supabase
            .from('asset_checks')
            .select('inv_no, name')
            .eq('stocktake_id', id)
            .eq('needs_label', true)
            .order('inv_no')
            .range(a, b),
        );
    items = rows.map((r) => ({ code: r.inv_no, title: r.name, footer: owner, mode: 'both' }));
    note = all ? 'მთელი რეესტრი' : 'დათვლისას „ეტიკეტი აკლია“ მონიშნული';
  } else if (src === 'shelves') {
    const [book, { data: zones }] = await Promise.all([
      pages<{ location_id: string }>((a, b) =>
        supabase
          .rpc('book_shelves', { p_stocktake: id })
          .range(a, b)
          .then((r) => ({ data: r.data as { location_id: string }[] | null })),
      ),
      supabase.from('stocktake_zones').select('location_id').eq('stocktake_id', id),
    ]);
    const ids = [
      ...new Set([
        ...book.map((r) => r.location_id),
        ...(zones ?? []).map((z) => z.location_id as string),
      ]),
    ].filter(Boolean);
    let locs: { code: string; name: string }[] = [];
    if (ids.length && !all) {
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase
          .from('locations')
          .select('code, name')
          .in('id', ids.slice(i, i + 300));
        locs.push(...(data ?? []));
      }
      note = 'ამ ინვენტარიზაციის თაროები';
    } else {
      locs = await pages<{ code: string; name: string }>((a, b) =>
        supabase
          .from('locations')
          .select('code, name')
          .eq('kind', 'shelf')
          .order('code')
          .range(a, b),
      );
      note = 'კომპანიის ყველა თარო';
    }
    locs.sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));
    items = locs.map((l) => ({
      code: l.code,
      title: l.name && l.name !== l.code ? l.name : 'თარო',
      footer: owner,
      mode: 'qr',
    }));
  } else {
    const [book, entries] = await Promise.all([
      pages<{ product_id: string }>((a, b) =>
        supabase.from('stocktake_book').select('product_id').eq('stocktake_id', id).range(a, b),
      ),
      pages<{ product_id: string | null }>((a, b) =>
        supabase
          .from('stocktake_entries')
          .select('product_id')
          .eq('stocktake_id', id)
          .not('product_id', 'is', null)
          .range(a, b),
      ),
    ]);
    const ids = [
      ...new Set([...book, ...entries].map((r) => r.product_id).filter(Boolean)),
    ] as string[];
    const prods: { name: string; sku: string; barcode: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase
        .from('products')
        .select('name, sku, barcode')
        .in('id', ids.slice(i, i + 300));
      prods.push(...(data ?? []));
    }
    prods.sort((a, b) => a.name.localeCompare(b.name, 'ka'));
    items = prods.map((p) => {
      const code = p.barcode || p.sku;
      const named = p.name && p.name !== code && !p.name.startsWith('ახალი · ');
      return { code, title: named ? p.name : '', mode: 'barcode' as const };
    });
    note = 'ამ ინვენტარიზაციის პროდუქცია (ნაშთი + დათვლილი)';
  }

  const tab = (s: Src, label: string) => (
    <Link
      href={`/count/${id}/labels?src=${s}`}
      className={`rounded-control border px-3 py-2 ${src === s ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="grid gap-4">
      <div className="no-print grid gap-3">
        <Link
          href={`/manage/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="text-xl font-semibold">🏷 ეტიკეტები</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {tab('shelves', '▦ თაროების QR')}
          {!isAssets && tab('products', '║ პროდუქციის შტრიხკოდი')}
          {isAssets && tab('assets', '№ ინვენტარის ნომრები')}
        </div>
        {src !== 'products' && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Link
              href={`/count/${id}/labels?src=${src}`}
              className={`rounded-control border px-2.5 py-1.5 ${!all ? 'border-ink font-semibold' : 'border-rule'}`}
            >
              {src === 'assets' ? 'ეტიკეტი აკლია' : 'ამ ინვენტარიზაციის'}
            </Link>
            <Link
              href={`/count/${id}/labels?src=${src}&all=1`}
              className={`rounded-control border px-2.5 py-1.5 ${all ? 'border-ink font-semibold' : 'border-rule'}`}
            >
              {src === 'assets' ? 'მთელი რეესტრი' : 'ყველა თარო'}
            </Link>
          </div>
        )}
        <p className="text-sm text-ink-soft">
          {items.length ? `${note}: ${items.length} ეტიკეტი.` : 'დასაბეჭდი ეტიკეტი არ არის.'}
        </p>
      </div>
      {items.length > 0 && (
        <ZebraPanel key={src} items={items} fileName={`${st.number}_${src}`} kind={src} />
      )}
    </div>
  );
}
