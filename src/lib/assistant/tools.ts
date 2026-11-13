import type Anthropic from '@anthropic-ai/sdk';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * What the assistant may look at. Every tool only reads, through the signed-in
 * user's own Supabase session (row-level security) and an explicit company
 * filter on top — another company's data is out of reach by construction.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_stocktakes',
    description:
      'Stocktakes (inventory counts) of the company, newest first, with progress and the value of surpluses/shortages. ' +
      'Use first to find a stocktake by number (INV-2026-0111), client, branch or date.',
    input_schema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Part of number, name, client or branch. Optional.',
        },
        status: { type: 'string', enum: ['open', 'closed', 'any'], description: 'Default any.' },
        include_archived: { type: 'boolean', description: 'Default false.' },
        limit: { type: 'integer', description: 'Default 20, max 50.' },
      },
    },
  },
  {
    name: 'stocktake_differences',
    description:
      'Per product of one stocktake: book (balance) quantity, counted quantity, difference and its value. ' +
      'Sorted by the size of the difference in money. For an open stocktake the numbers are not final.',
    input_schema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Stocktake number, e.g. INV-2026-0111.' },
        only: {
          type: 'string',
          enum: ['all', 'shortage', 'surplus', 'not_counted'],
          description: 'Default all differences (matching lines are left out).',
        },
        limit: { type: 'integer', description: 'Default 30, max 100.' },
      },
      required: ['number'],
    },
  },
  {
    name: 'stocktake_progress',
    description:
      'Shelves of one stocktake: how many are closed, which are still being counted or not started, and who counted.',
    input_schema: {
      type: 'object',
      properties: { number: { type: 'string' } },
      required: ['number'],
    },
  },
  {
    name: 'find_product',
    description:
      'Find products by name, barcode or code, with where and how much they were counted in recent stocktakes and their book quantity.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
];

const n = (v: unknown) => Math.round(Number(v ?? 0) * 1000) / 1000;
const money = (v: number) => Math.round(v * 100) / 100;

async function stocktakeByNumber(db: Db, companyId: string, number: string) {
  const { data } = await db
    .from('stocktakes')
    .select('id, number, name, client_name, branch, count_date, status, kind')
    .eq('company_id', companyId)
    .ilike('number', `%${number.trim().replace(/[%_,()]/g, '')}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Fetches all rows of a query in pages of 1000 (PostgREST caps a response). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await page(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function runTool(
  db: Db,
  companyId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'list_stocktakes') {
    const limit = Math.min(Number(input.limit) || 20, 50);
    let q = db
      .from('stocktakes')
      .select(
        'id, number, name, client_name, branch, count_date, status, kind, form_kind, archived_at',
      )
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (input.status === 'open' || input.status === 'closed') q = q.eq('status', input.status);
    if (!input.include_archived) q = q.is('archived_at', null);
    const s = String(input.search ?? '')
      .replace(/[%_,()]/g, '')
      .trim();
    if (s)
      q = q.or(
        ['number', 'name', 'client_name', 'branch'].map((c) => `${c}.ilike.%${s}%`).join(','),
      );
    const { data } = await q;
    const list = data ?? [];
    const stock = list.filter((x) => x.kind !== 'assets').map((x) => x.id);
    const { data: stats } = stock.length
      ? await db.rpc('stocktake_stats4', { p_ids: stock })
      : { data: [] };
    const byId = new Map(
      ((stats ?? []) as Record<string, unknown>[]).map((r) => [r.stocktake_id as string, r]),
    );
    return list.map((x) => {
      const st = byId.get(x.id);
      return {
        number: x.number,
        name: x.name,
        client: x.client_name,
        branch: x.branch,
        date: x.count_date,
        status: x.status,
        kind: x.kind,
        form: x.form_kind,
        archived: !!x.archived_at,
        ...(st && {
          shelves_done: `${st.shelves_done}/${st.shelves}`,
          products: st.skus,
          counted_qty: n(st.counted_qty),
          surplus_qty: n(st.plus_qty),
          surplus_value: money(Number(st.plus_sum ?? 0)),
          shortage_qty: n(st.minus_qty),
          shortage_value: money(Number(st.minus_sum ?? 0)),
          not_yet_counted_qty: n(st.left_qty),
        }),
      };
    });
  }

  if (name === 'stocktake_differences') {
    const st = await stocktakeByNumber(db, companyId, String(input.number ?? ''));
    if (!st) return { error: 'ასეთი ინვენტარიზაცია ვერ ვიპოვე.' };
    const [book, entries] = await Promise.all([
      all<{ product_id: string; book_qty: number; unit_cost: number | null }>((a, b) =>
        db
          .from('stocktake_book')
          .select('product_id, book_qty, unit_cost')
          .eq('stocktake_id', st.id)
          .range(a, b),
      ),
      all<{ product_id: string | null; unknown_label: string | null; quantity: number }>((a, b) =>
        db
          .from('stocktake_entries')
          .select('product_id, unknown_label, quantity')
          .eq('stocktake_id', st.id)
          .range(a, b),
      ),
    ]);
    const rows = new Map<string, { book: number; counted: number; price: number }>();
    const row = (id: string) => {
      let r = rows.get(id);
      if (!r) rows.set(id, (r = { book: 0, counted: 0, price: 0 }));
      return r;
    };
    for (const b of book) {
      const r = row(b.product_id);
      r.book += Number(b.book_qty);
      r.price = Math.max(r.price, Number(b.unit_cost ?? 0));
    }
    let unknown = 0;
    for (const e of entries)
      if (e.product_id) row(e.product_id).counted += Number(e.quantity);
      else unknown += Number(e.quantity);
    const only = String(input.only ?? 'all');
    const diffs = [...rows.entries()]
      .map(([id, r]) => ({ id, ...r, diff: r.counted - r.book }))
      .filter((r) => r.diff !== 0)
      .filter((r) =>
        only === 'shortage'
          ? r.diff < 0
          : only === 'surplus'
            ? r.diff > 0
            : only === 'not_counted'
              ? r.counted === 0
              : true,
      )
      .sort(
        (a, b) =>
          Math.abs(b.diff * b.price) - Math.abs(a.diff * a.price) ||
          Math.abs(b.diff) - Math.abs(a.diff),
      );
    const limit = Math.min(Number(input.limit) || 30, 100);
    const top = diffs.slice(0, limit);
    const { data: prods } = top.length
      ? await db
          .from('products')
          .select('id, sku, barcode, name, unit')
          .in(
            'id',
            top.map((r) => r.id),
          )
      : { data: [] };
    const p = new Map((prods ?? []).map((x) => [x.id, x]));
    const sum = (f: (r: (typeof diffs)[number]) => boolean) =>
      money(diffs.filter(f).reduce((s, r) => s + r.diff * r.price, 0));
    return {
      stocktake: { number: st.number, name: st.name, status: st.status, date: st.count_date },
      note:
        st.status === 'open'
          ? 'ინვენტარიზაცია ღიაა — დაუთვლელი თაროები ნაკლებობად ჩანს.'
          : undefined,
      lines_with_difference: diffs.length,
      shortage_value: sum((r) => r.diff < 0),
      surplus_value: sum((r) => r.diff > 0),
      counted_without_product_card: n(unknown),
      lines: top.map((r) => ({
        name: p.get(r.id)?.name,
        code: p.get(r.id)?.barcode ?? p.get(r.id)?.sku,
        unit: p.get(r.id)?.unit,
        book: n(r.book),
        counted: n(r.counted),
        diff: n(r.diff),
        price: r.price || null,
        value: r.price ? money(r.diff * r.price) : null,
      })),
    };
  }

  if (name === 'stocktake_progress') {
    const st = await stocktakeByNumber(db, companyId, String(input.number ?? ''));
    if (!st) return { error: 'ასეთი ინვენტარიზაცია ვერ ვიპოვე.' };
    const [{ data: zones }, { data: booked }] = await Promise.all([
      db
        .from('stocktake_zones')
        .select('status, started_at, done_at, locations (code), user_profiles (full_name, email)')
        .eq('stocktake_id', st.id)
        .limit(3000),
      db.from('stocktake_book').select('location_id').eq('stocktake_id', st.id).limit(20000),
    ]);
    type Z = {
      status: string;
      done_at: string | null;
      locations: { code: string } | null;
      user_profiles: { full_name: string | null; email: string } | null;
    };
    const z = (zones ?? []) as unknown as Z[];
    const started = new Set(z.map((x) => x.locations?.code));
    const bookedShelves = new Set((booked ?? []).map((b) => b.location_id).filter(Boolean));
    const byCounter = new Map<string, number>();
    for (const x of z) {
      const who = x.user_profiles?.full_name || x.user_profiles?.email || '—';
      if (x.status === 'done') byCounter.set(who, (byCounter.get(who) ?? 0) + 1);
    }
    return {
      stocktake: { number: st.number, name: st.name, status: st.status },
      shelves_with_book: bookedShelves.size,
      shelves_started: started.size,
      shelves_done: z.filter((x) => x.status === 'done').length,
      still_counting: z.filter((x) => x.status !== 'done').map((x) => x.locations?.code),
      closed_by_counter: Object.fromEntries(byCounter),
    };
  }

  if (name === 'find_product') {
    const q = String(input.query ?? '')
      .replace(/[%_,()]/g, ' ')
      .trim();
    if (!q) return [];
    const { data: prods } = await db
      .from('products')
      .select('id, sku, barcode, name, variant, unit')
      .eq('company_id', companyId)
      .or(`name.ilike.%${q}%,barcode.eq.${q},sku.ilike.${q}`)
      .limit(8);
    const list = prods ?? [];
    if (!list.length) return [];
    const ids = list.map((p) => p.id);
    const [{ data: entries }, { data: book }] = await Promise.all([
      db
        .from('stocktake_entries')
        .select('product_id, quantity, created_at, stocktakes (number), locations (code)')
        .in('product_id', ids)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('stocktake_book')
        .select('product_id, book_qty, created_at, stocktakes (number)')
        .in('product_id', ids)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
    type E = {
      product_id: string;
      quantity: number;
      stocktakes: { number: string } | null;
      locations: { code: string } | null;
    };
    type B = { product_id: string; book_qty: number; stocktakes: { number: string } | null };
    return list.map((p) => {
      const counts = new Map<string, number>();
      for (const e of (entries ?? []) as unknown as E[])
        if (e.product_id === p.id) {
          const k = `${e.stocktakes?.number} · ${e.locations?.code ?? '—'}`;
          counts.set(k, (counts.get(k) ?? 0) + Number(e.quantity));
        }
      const bk = new Map<string, number>();
      for (const b of (book ?? []) as unknown as B[])
        if (b.product_id === p.id) {
          const k = b.stocktakes?.number ?? '—';
          bk.set(k, (bk.get(k) ?? 0) + Number(b.book_qty));
        }
      return {
        name: p.name,
        variant: p.variant,
        code: p.barcode ?? p.sku,
        unit: p.unit,
        counted: [...counts.entries()].slice(0, 15).map(([where, qty]) => ({ where, qty: n(qty) })),
        book: [...bk.entries()].slice(0, 8).map(([stocktake, qty]) => ({ stocktake, qty: n(qty) })),
      };
    });
  }

  return { error: `unknown tool ${name}` };
}
