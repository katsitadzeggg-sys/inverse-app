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
  /** Shelves it was counted on; media = the shelf's own photos/videos. */
  shelves: { id: string; code: string; media: number; photos: number; videos: number }[];
  /** Link to the photo taken of this very product (new products), if any. */
  photo: string | null;
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
  /**
   * Open stocktake: only closed shelves are compared; the book on shelves
   * not closed yet is "remaining". Closed stocktake: everything (left = 0).
   */
  left: { qty: number; sum: number; shelves: number; skus: number };
  final: boolean;
};

type Book = {
  product_id: string;
  book_qty: number;
  unit_cost: number | null;
  location_id: string | null;
};
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
        .select('product_id, book_qty, unit_cost, location_id')
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
      .select('location_id, status, locations (code), user_profiles (full_name, email)')
      .eq('stocktake_id', id)
      .returns<
        {
          location_id: string;
          status: string;
          locations: { code: string } | null;
          user_profiles: { full_name: string | null; email: string } | null;
        }[]
      >(),
  ]);
  const shelfCode = new Map((zones ?? []).map((z) => [z.location_id, z.locations?.code ?? '']));
  const { data: stRow } = await supabase
    .from('stocktakes')
    .select('status')
    .eq('id', id)
    .maybeSingle<{ status: string }>();
  const final = stRow?.status === 'closed';
  const doneShelves = new Set(
    (zones ?? []).filter((z) => z.status === 'done').map((z) => z.location_id),
  );
  const onClosed = (lid: string | null) => final || (!!lid && doneShelves.has(lid));
  // Book lines with no shelf are matched at warehouse level: what was counted
  // of such a product on closed shelves (beyond its shelved book) is matched
  // against it; only a count above the book is surplus, the rest stays
  // "remaining" until it is found or the stocktake is closed.
  const shelvedDone = new Map<string, number>();
  const unshelved = new Map<string, number>();
  for (const b of book) {
    const m = b.location_id ? (onClosed(b.location_id) ? shelvedDone : null) : unshelved;
    if (m) m.set(b.product_id, (m.get(b.product_id) ?? 0) + Number(b.book_qty));
  }
  const countedDone = new Map<string, number>();
  for (const e of entries)
    if (e.product_id && onClosed(e.location_id))
      countedDone.set(e.product_id, (countedDone.get(e.product_id) ?? 0) + Number(e.quantity));
  const matched = new Map<string, number>();
  for (const [pid, q] of unshelved)
    matched.set(
      pid,
      final
        ? q
        : Math.min(q, Math.max((countedDone.get(pid) ?? 0) - (shelvedDone.get(pid) ?? 0), 0)),
    );
  const left = { qty: 0, sum: 0, shelves: 0, skus: 0 };
  {
    const leftShelves = new Set<string>();
    const leftSkus = new Set<string>();
    const cost = new Map<string, number>();
    for (const b of book) if (b.unit_cost != null) cost.set(b.product_id, Number(b.unit_cost));
    const add = (pid: string, q: number) => {
      if (!q) return;
      left.qty += q;
      left.sum += q * (cost.get(pid) ?? 0);
      leftSkus.add(pid);
    };
    if (!final) {
      for (const b of book)
        if (b.location_id && !onClosed(b.location_id)) {
          add(b.product_id, Number(b.book_qty));
          leftShelves.add(b.location_id);
        }
      for (const [pid, q] of unshelved) add(pid, q - (matched.get(pid) ?? 0));
    }
    left.shelves = leftShelves.size;
    left.skus = leftSkus.size;
  }
  const { data: media } = await supabase
    .from('stocktake_media')
    .select('location_id, path, kind')
    .eq('stocktake_id', id)
    .returns<{ location_id: string; path: string; kind: string }[]>();
  const mediaCount = new Map<string, { photos: number; videos: number }>();
  // Photos of single lines (new products) are not the shelf's photos.
  for (const m of (media ?? []).filter((x) => !/\/product-[^/]+$/.test(x.path))) {
    const c = mediaCount.get(m.location_id) ?? { photos: 0, videos: 0 };
    if (m.kind === 'video') c.videos += 1;
    else c.photos += 1;
    mediaCount.set(m.location_id, c);
  }
  const shelfList = (ids: Set<string>) =>
    [...ids]
      .map((lid) => {
        const c = mediaCount.get(lid) ?? { photos: 0, videos: 0 };
        return { id: lid, code: shelfCode.get(lid) ?? '', media: c.photos + c.videos, ...c };
      })
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
  // A price from any book line (a surplus found on a closed shelf may be
  // booked on a shelf still open).
  const price = new Map<string, number>();
  for (const b of book) if (b.unit_cost != null) price.set(b.product_id, Number(b.unit_cost));
  for (const b of book) {
    if (!b.location_id || !onClosed(b.location_id)) continue;
    const r = row(b.product_id);
    r.book += Number(b.book_qty);
    r.cost = b.unit_cost ?? r.cost;
  }
  for (const [pid, q] of matched) {
    if (!q) continue;
    const r = row(pid);
    r.book += q;
    r.cost = r.cost ?? price.get(pid) ?? null;
  }
  const unknown = new Map<string, { qty: number; shelves: Set<string> }>();
  for (const e of entries) {
    // Lines of a shelf still being counted wait until the shelf is closed.
    if (!onClosed(e.location_id)) continue;
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
    r.cost = r.cost ?? price.get(e.product_id) ?? null;
    r.counted += Number(e.quantity);
    if (code) r.shelves.add(code);
  }

  const ids = [...rows.keys()];
  const info = new Map<
    string,
    {
      name: string;
      sku: string;
      barcode: string | null;
      unit: string;
      category_id: string | null;
      image_url: string | null;
    }
  >();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, barcode, unit, category_id, image_url')
      .in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) info.set(p.id, p);
  }
  // Product photos of counted products, as links that work for a week.
  const photoOf = new Map<string, string>();
  {
    const want = [...rows.entries()]
      .filter(([pid, r]) => r.counted && info.get(pid)?.image_url)
      .map(([pid]) => [pid, info.get(pid)!.image_url!] as const);
    const stored = want.filter(([, path]) => !/^https?:\/\//.test(path));
    for (const [pid, path] of want) if (/^https?:\/\//.test(path)) photoOf.set(pid, path);
    for (let i = 0; i < stored.length; i += 100) {
      const part = stored.slice(i, i + 100);
      const { data } = await supabase.storage.from('stocktake-media').createSignedUrls(
        part.map(([, path]) => path),
        60 * 60 * 24 * 7,
      );
      (data ?? []).forEach((d, j) => d.signedUrl && photoOf.set(part[j][0], d.signedUrl));
    }
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
        photo: photoOf.get(pid) ?? null,
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
      photo: null,
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
  return { lines, hasCost: lines.some((l) => l.cost != null), totals, team, left, final };
}
