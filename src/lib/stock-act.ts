import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The stock count act in the shape of a Balance (1C) "ინვენტარიზაცია"
 * document: one line per product — article, name, main barcode, unit,
 * book quantity, counted quantity, difference, price, comment (shelves).
 * Used by the act page and its Excel download.
 */
export type ActLine = {
  n: number;
  sku: string;
  name: string;
  barcode: string;
  unit: string;
  book: number;
  counted: number;
  diff: number;
  cost: number | null;
  comment: string;
  /** The product's group (category). */
  group: string;
  /** Shelves it was counted on; media = photos/videos of that shelf. */
  shelves: { id: string; code: string; media: number }[];
};

export type ActData = {
  lines: ActLine[];
  hasCost: boolean;
  totals: {
    book: number;
    counted: number;
    diff: number;
    plus: number;
    minus: number;
    bookSum: number;
    countedSum: number;
    plusSum: number;
    minusSum: number;
  };
  team: string[];
};

type Book = { product_id: string; book_qty: number; unit_cost: number | null };
type Entry = {
  product_id: string | null;
  unknown_label: string | null;
  quantity: number;
  location_id: string;
};

/** Balance shows units in full words. */
export const unitWord = (u?: string | null) =>
  !u || u === 'pcs' || u === 'ც' ? 'ცალი' : u === 'kg' ? 'კგ' : u === 'l' ? 'ლ' : u;

async function pages<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function stockActData(supabase: SupabaseClient, id: string): Promise<ActData> {
  const [book, entries, { data: zones }] = await Promise.all([
    pages<Book>((a, b) =>
      supabase
        .from('stocktake_book')
        .select('product_id, book_qty, unit_cost')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    pages<Entry>((a, b) =>
      supabase
        .from('stocktake_entries')
        .select('product_id, unknown_label, quantity, location_id')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    supabase
      .from('stocktake_zones')
      .select('location_id, locations (code), user_profiles (full_name, email)')
      .eq('stocktake_id', id)
      .returns<
        {
          location_id: string;
          locations: { code: string } | null;
          user_profiles: { full_name: string | null; email: string } | null;
        }[]
      >(),
  ]);
  const shelfCode = new Map((zones ?? []).map((z) => [z.location_id, z.locations?.code ?? '']));
  const { data: media } = await supabase
    .from('stocktake_media')
    .select('location_id')
    .eq('stocktake_id', id)
    .returns<{ location_id: string }[]>();
  const mediaCount = new Map<string, number>();
  for (const m of media ?? [])
    mediaCount.set(m.location_id, (mediaCount.get(m.location_id) ?? 0) + 1);
  const shelfList = (ids: Set<string>) =>
    [...ids]
      .map((lid) => ({ id: lid, code: shelfCode.get(lid) ?? '', media: mediaCount.get(lid) ?? 0 }))
      .sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));

  const rows = new Map<
    string,
    { book: number; counted: number; cost: number | null; shelves: Set<string> }
  >();
  const row = (pid: string) => {
    let r = rows.get(pid);
    if (!r) rows.set(pid, (r = { book: 0, counted: 0, cost: null, shelves: new Set() }));
    return r;
  };
  for (const b of book) {
    const r = row(b.product_id);
    r.book += Number(b.book_qty);
    r.cost = b.unit_cost ?? r.cost;
  }
  const unknown = new Map<string, { qty: number; shelves: Set<string> }>();
  for (const e of entries) {
    const code = e.location_id;
    if (!e.product_id) {
      const k = e.unknown_label ?? '?';
      const u = unknown.get(k) ?? { qty: 0, shelves: new Set<string>() };
      u.qty += Number(e.quantity);
      if (code) u.shelves.add(code);
      unknown.set(k, u);
      continue;
    }
    const r = row(e.product_id);
    r.counted += Number(e.quantity);
    if (code) r.shelves.add(code);
  }

  const ids = [...rows.keys()];
  const info = new Map<
    string,
    { name: string; sku: string; barcode: string | null; unit: string; category_id: string | null }
  >();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, barcode, unit, category_id')
      .in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) info.set(p.id, p);
  }
  const { data: cats } = await supabase.from('categories').select('id, name');
  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));

  const lines: ActLine[] = [...rows.entries()]
    .map(([pid, r]) => {
      const p = info.get(pid);
      return {
        n: 0,
        sku: p?.sku ?? '',
        name: p?.name ?? '',
        barcode: p?.barcode ?? p?.sku ?? '',
        unit: unitWord(p?.unit),
        book: r.book,
        counted: r.counted,
        diff: r.counted - r.book,
        cost: r.cost,
        comment: '',
        group: p?.category_id ? (catName.get(p.category_id) ?? '') : '',
        shelves: shelfList(r.shelves),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ka'));
  for (const [label, u] of unknown)
    lines.push({
      n: 0,
      sku: '',
      name: `❓ ${label}`,
      barcode: '',
      unit: 'ცალი',
      book: 0,
      counted: u.qty,
      diff: u.qty,
      cost: null,
      comment: 'უცნობი პროდუქტი',
      group: '',
      shelves: shelfList(u.shelves),
    });
  lines.forEach((l, i) => (l.n = i + 1));

  const totals = {
    book: 0,
    counted: 0,
    diff: 0,
    plus: 0,
    minus: 0,
    bookSum: 0,
    countedSum: 0,
    plusSum: 0,
    minusSum: 0,
  };
  for (const l of lines) {
    const c = l.cost ?? 0;
    totals.book += l.book;
    totals.counted += l.counted;
    totals.diff += l.diff;
    totals.bookSum += l.book * c;
    totals.countedSum += l.counted * c;
    if (l.diff > 0) {
      totals.plus += l.diff;
      totals.plusSum += l.diff * c;
    }
    if (l.diff < 0) {
      totals.minus -= l.diff;
      totals.minusSum -= l.diff * c;
    }
  }
  const team = [
    ...new Set(
      (zones ?? [])
        .map((z) => z.user_profiles?.full_name ?? z.user_profiles?.email)
        .filter(Boolean),
    ),
  ] as string[];
  return { lines, hasCost: lines.some((l) => l.cost != null), totals, team };
}
