import type { SupabaseClient } from '@supabase/supabase-js';
import type { Stocktake } from '@/types/database';
import type { LabelData } from '@/lib/zebra';

export type LabelSrc = 'shelves' | 'products' | 'assets';

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
 * One stocktake's labels: its shelves' QR codes, its products' barcodes, or
 * the inventory numbers of fixed assets (those marked "label missing", or the
 * whole register with all = true). Reads go through the caller's client, so
 * row-level security keeps them to the caller's company.
 */
export async function stocktakeLabels(
  supabase: SupabaseClient,
  st: Stocktake,
  want: string | undefined,
  all: boolean,
): Promise<{ src: LabelSrc; items: LabelData[]; note: string }> {
  const id = st.id;
  const isAssets = st.kind === 'assets';
  const src: LabelSrc =
    want === 'shelves' || want === 'products' || want === 'assets'
      ? want
      : isAssets
        ? 'assets'
        : 'shelves';
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
    items = rows.map((r) => ({
      code: r.inv_no,
      title: r.name,
      sub: 'ბუღ. №',
      footer: owner,
      mode: 'both',
    }));
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
      pages<{ product_id: string; book_qty: number | string | null }>((a, b) =>
        supabase
          .from('stocktake_book')
          .select('product_id, book_qty')
          .eq('stocktake_id', id)
          .range(a, b),
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
    // Book quantity per product (all shelves together), for one label per unit.
    const bookQty = new Map<string, number>();
    for (const r of book)
      bookQty.set(r.product_id, (bookQty.get(r.product_id) ?? 0) + (Number(r.book_qty) || 0));
    const prods: { id: string; name: string; sku: string; barcode: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, barcode')
        .in('id', ids.slice(i, i + 300));
      prods.push(...(data ?? []));
    }
    prods.sort((a, b) => a.name.localeCompare(b.name, 'ka'));
    items = prods.map((p) => {
      const code = p.barcode || p.sku;
      const named = p.name && p.name !== code && !p.name.startsWith('ახალი · ');
      const q = bookQty.get(p.id);
      return {
        code,
        title: named ? p.name : '',
        sub: p.barcode && p.sku && p.sku !== p.barcode ? `კოდი ${p.sku}` : undefined,
        mode: 'barcode' as const,
        qty: q == null ? null : Math.max(0, Math.ceil(q)),
      };
    });
    note = 'ამ ინვენტარიზაციის პროდუქცია (ნაშთი + დათვლილი)';
  }

  return { src, items, note };
}
