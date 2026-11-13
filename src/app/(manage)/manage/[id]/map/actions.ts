'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import {
  productShelves,
  searchProducts,
  warehousePool,
  type FoundProduct,
} from '@/lib/shelf-finder';

/** A product typed on the map: which shelves of this warehouse it is on. */
export async function findOnMap(stocktakeId: string, q: string): Promise<FoundProduct[]> {
  const { company } = await requireSession();
  const db = await createClient();
  const pool = await warehousePool(db, stocktakeId);
  if (!pool) return [];
  const prods = await searchProducts(db, company.id, q);
  if (!prods.length) return [];
  const where = await productShelves(
    db,
    pool.ids,
    prods.map((p) => p.id),
  );
  return prods.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.barcode ?? p.sku,
    unit: p.unit,
    shelves: where.get(p.id) ?? [],
  }));
}
