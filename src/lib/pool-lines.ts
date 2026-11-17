import type { SupabaseClient } from '@supabase/supabase-js';

export type PoolLine = {
  product_id: string;
  cur_qty: number;
  ref_qty: number | null;
  counted_qty: number | null;
  price: number;
  status: string;
  zeroed: boolean;
  moved: boolean;
};

/**
 * Every line of pool_lines for a warehouse's stocktakes. The API hands out at
 * most 1 000 rows per call, and a balance has thousands of products: read it
 * in pages, or the missed / shortage figures stop at the first 1 000.
 */
export async function allPoolLines(supabase: SupabaseClient, ids: string[]): Promise<PoolLine[]> {
  const out: PoolLine[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await supabase
      .rpc('pool_lines', { p_ids: ids })
      .order('product_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PoolLine[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
