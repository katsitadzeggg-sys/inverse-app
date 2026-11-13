import type { createClient } from '@/lib/supabase/server';
import { barcodeVariants, normKey } from '@/lib/text';

type Db = Awaited<ReturnType<typeof createClient>>;

/** One shelf a product is on: by the balance (book) and/or where it was counted. */
export type ProductShelf = {
  locationId: string;
  code: string;
  book: number;
  counted: number;
  /** Seen there only in an older stocktake outside this warehouse's current ones. */
  earlier?: string;
};
export type FoundProduct = {
  id: string;
  name: string;
  code: string;
  unit: string | null;
  shelves: ProductShelf[];
  status?: 'missed' | 'review';
};

/** The stocktakes counted as one warehouse with this one: same branch/client/name, not archived. */
export async function warehousePool(db: Db, stocktakeId: string) {
  const { data: st } = await db
    .from('stocktakes')
    .select('id, branch, client_name, name, kind, company_id, cycle_id')
    .eq('id', stocktakeId)
    .maybeSingle();
  if (!st) return null;
  const key = st.branch || st.client_name || st.name;
  if (st.kind === 'assets') return { key, ids: [st.id] };
  let q = db
    .from('stocktakes')
    .select('id, branch, client_name, name')
    .eq('company_id', st.company_id)
    .neq('kind', 'assets')
    .is('archived_at', null)
    .limit(500);
  // Within the same count cycle only: a closed quarter does not mix in.
  if (st.cycle_id) q = q.eq('cycle_id', st.cycle_id);
  const { data } = await q;
  const ids = (data ?? [])
    .filter((s) => (s.branch || s.client_name || s.name) === key)
    .map((s) => s.id as string);
  return { key, ids: ids.length ? ids : [st.id] };
}

/**
 * Where these products are: shelves from the balance and from the counts of
 * the warehouse's stocktakes. A product with no shelf there gets the shelves
 * it was last counted on in earlier stocktakes, marked as such.
 */
export async function productShelves(
  db: Db,
  poolIds: string[],
  productIds: string[],
): Promise<Map<string, ProductShelf[]>> {
  const out = new Map<string, Map<string, ProductShelf>>();
  if (!productIds.length) return new Map();
  const add = (pid: string, locId: string, code: string, f: (s: ProductShelf) => void) => {
    let m = out.get(pid);
    if (!m) out.set(pid, (m = new Map()));
    let s = m.get(locId);
    if (!s) m.set(locId, (s = { locationId: locId, code, book: 0, counted: 0 }));
    f(s);
  };
  type B = {
    product_id: string;
    location_id: string;
    book_qty: number;
    locations: { code: string } | null;
  };
  type E = {
    product_id: string;
    location_id: string;
    quantity: number;
    stocktake_id: string;
    locations: { code: string } | null;
    stocktakes?: { number: string } | null;
  };
  for (let i = 0; i < productIds.length; i += 200) {
    const chunk = productIds.slice(i, i + 200);
    const [{ data: book }, { data: entries }] = await Promise.all([
      db
        .from('stocktake_book')
        .select('product_id, location_id, book_qty, locations (code)')
        .in('stocktake_id', poolIds)
        .in('product_id', chunk)
        .not('location_id', 'is', null)
        .limit(5000),
      db
        .from('stocktake_entries')
        .select('product_id, location_id, quantity, stocktake_id, locations (code)')
        .in('stocktake_id', poolIds)
        .in('product_id', chunk)
        .limit(5000),
    ]);
    for (const b of (book ?? []) as unknown as B[])
      if (b.locations)
        add(b.product_id, b.location_id, b.locations.code, (s) => (s.book += Number(b.book_qty)));
    for (const e of (entries ?? []) as unknown as E[])
      if (e.locations)
        add(
          e.product_id,
          e.location_id,
          e.locations.code,
          (s) => (s.counted += Number(e.quantity)),
        );
  }

  // Nothing in this warehouse's stocktakes: the shelves of its latest earlier count.
  const lost = productIds.filter((p) => !out.has(p)).slice(0, 300);
  if (lost.length) {
    const { data } = await db
      .from('stocktake_entries')
      .select(
        'product_id, location_id, quantity, stocktake_id, created_at, locations (code), stocktakes (number)',
      )
      .in('product_id', lost)
      .order('created_at', { ascending: false })
      .limit(3000);
    const firstSt = new Map<string, string>();
    for (const e of (data ?? []) as unknown as E[]) {
      if (!e.locations) continue;
      const st = firstSt.get(e.product_id) ?? e.stocktake_id;
      firstSt.set(e.product_id, st);
      if (st !== e.stocktake_id) continue; // only the latest stocktake that counted it
      add(e.product_id, e.location_id, e.locations.code, (s) => {
        s.counted += Number(e.quantity);
        s.earlier = e.stocktakes?.number ?? 'ძველი დათვლა';
      });
    }
  }

  const res = new Map<string, ProductShelf[]>();
  for (const [pid, m] of out)
    res.set(
      pid,
      [...m.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    );
  return res;
}

/** Products of the company by name (any word order), barcode or code. */
export async function searchProducts(db: Db, companyId: string, q: string, limit = 12) {
  const t = q.replace(/[%_,()\\"']/g, ' ').trim();
  if (!t) return [];
  const cols = 'id, sku, barcode, name, unit';
  const { data: exact } = await db
    .from('products')
    .select(cols)
    .eq('company_id', companyId)
    .or(
      barcodeVariants(t)
        .flatMap((v) => [`barcode.eq.${v}`, `sku.ilike.${v}`])
        .join(','),
    )
    .limit(5);
  if (exact?.length) return exact;
  let byName = db.from('products').select(cols).eq('company_id', companyId);
  for (const w of t.split(/\s+/).slice(0, 6)) {
    const stem = w.length >= 5 ? w.slice(0, -2) : w.length === 4 ? w.slice(0, -1) : w;
    byName = byName.ilike('name', `%${stem}%`);
  }
  const { data } = await byName.order('name').limit(limit);
  return data ?? [];
}

/** Shelf codes compared loosely: "1p-03 / 12", "1P0312" and "1P-3-12" are the same shelf. */
export const shelfKey = (code: string) => normKey(code).replace(/(^|[^0-9])0+(?=\d)/g, '$1');
