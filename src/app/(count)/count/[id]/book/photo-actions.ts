'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type PhotoRow = { codes: string[]; url: string };

/**
 * Product photos from links in a file (barcode / SKU / article → photo URL).
 * Matches this company's products by barcode, extra barcodes or SKU and fills
 * the photo where it is empty (replace = true overwrites). Only http(s) links
 * are taken; the photo stays where it is (the link), nothing is copied.
 */
export async function setProductPhotos(
  rows: PhotoRow[],
  replace = false,
): Promise<{ error?: string; matched?: number; updated?: number }> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'ფოტოებს მხოლოდ მენეჯერი ტვირთავს.' };
  const clean = rows
    .map((r) => ({
      url: r.url.trim(),
      codes: [...new Set(r.codes.map((c) => c.trim()).filter((c) => c.length >= 4))],
    }))
    .filter((r) => /^https?:\/\/\S+$/i.test(r.url) && r.codes.length);
  if (!clean.length) return { matched: 0, updated: 0 };

  const db = await createClient();
  const codes = [...new Set(clean.flatMap((r) => r.codes))];
  const byCode = new Map<string, Set<string>>();
  const add = (code: string | null, id: string) => {
    if (!code) return;
    const k = code.trim();
    if (!byCode.has(k)) byCode.set(k, new Set());
    byCode.get(k)!.add(id);
  };
  const image = new Map<string, string | null>();
  for (let i = 0; i < codes.length; i += 300) {
    const part = codes.slice(i, i + 300);
    const [a, b, c] = await Promise.all([
      db
        .from('products')
        .select('id, barcode, image_url')
        .eq('company_id', company.id)
        .in('barcode', part),
      db.from('products').select('id, sku, image_url').eq('company_id', company.id).in('sku', part),
      db
        .from('product_barcodes')
        .select('product_id, barcode')
        .eq('company_id', company.id)
        .in('barcode', part),
    ]);
    if (a.error || b.error || c.error) return { error: (a.error ?? b.error ?? c.error)!.message };
    for (const p of a.data ?? []) {
      add(p.barcode, p.id);
      image.set(p.id, p.image_url);
    }
    for (const p of b.data ?? []) {
      add(p.sku, p.id);
      image.set(p.id, p.image_url);
    }
    for (const p of c.data ?? []) add(p.barcode, p.product_id);
  }

  // One link per product: the first row that names it.
  const target = new Map<string, string>();
  for (const r of clean)
    for (const code of r.codes)
      for (const id of byCode.get(code) ?? []) if (!target.has(id)) target.set(id, r.url);

  const missing = [...target.keys()].filter((id) => !image.has(id));
  for (let i = 0; i < missing.length; i += 300) {
    const { data } = await db
      .from('products')
      .select('id, image_url')
      .eq('company_id', company.id)
      .in('id', missing.slice(i, i + 300));
    for (const p of data ?? []) image.set(p.id, p.image_url);
  }

  const todo = [...target.entries()].filter(
    ([id, url]) => image.get(id) !== url && (replace || !image.get(id)),
  );
  let updated = 0;
  for (let i = 0; i < todo.length; i += 25) {
    const res = await Promise.all(
      todo
        .slice(i, i + 25)
        .map(([id, url]) =>
          db.from('products').update({ image_url: url }).eq('id', id).eq('company_id', company.id),
        ),
    );
    const bad = res.find((r) => r.error);
    if (bad?.error) return { error: bad.error.message, matched: target.size, updated };
    updated += res.length;
  }
  return { matched: target.size, updated };
}
