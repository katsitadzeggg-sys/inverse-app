'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { InventoryCheck, InventoryCheckItem } from '@/types/database';

/**
 * Writes the AI's counts back onto the record for the checked location.
 *
 * Deliberately an explicit human action rather than an automatic consequence of a
 * check: items the model could not identify on its own (look-alike variants) are
 * skipped, so a barcode scan still decides those.
 */
export async function applyCounts(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session.canWrite) return;

  const checkId = String(formData.get('check_id') ?? '');
  if (!checkId) return;

  const supabase = await createClient();

  const { data: check } = await supabase
    .from('inventory_checks')
    .select('id, location_id, status')
    .eq('id', checkId)
    .maybeSingle<Pick<InventoryCheck, 'id' | 'location_id' | 'status'>>();

  if (!check || check.status !== 'completed') return;

  const { data: items } = await supabase
    .from('inventory_check_items')
    .select('product_id, detected_qty, status, needs_barcode')
    .eq('check_id', checkId)
    .returns<
      Pick<InventoryCheckItem, 'product_id' | 'detected_qty' | 'status' | 'needs_barcode'>[]
    >();

  const applicable = (items ?? []).filter(
    (item) =>
      item.product_id !== null &&
      item.detected_qty !== null &&
      !item.needs_barcode &&
      (item.status === 'match' || item.status === 'mismatch'),
  );

  if (applicable.length === 0) return;

  const countedAt = new Date().toISOString();
  await supabase.from('inventory_levels').upsert(
    applicable.map((item) => ({
      company_id: session.company.id,
      product_id: item.product_id as string,
      location_id: check.location_id,
      quantity: item.detected_qty as number,
      counted_at: countedAt,
    })),
    { onConflict: 'product_id,location_id' },
  );

  revalidatePath(`/checks/${checkId}`);
  revalidatePath('/products');
  revalidatePath('/dashboard');
}
