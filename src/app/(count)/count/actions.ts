'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Product } from '@/types/database';

export type FormState = { error?: string; notice?: string };

const isManager = (role: string) => role === 'owner' || role === 'admin';

/** Owners/admins open a new stocktake. */
export async function createStocktake(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'ინვენტარიზაციას მხოლოდ მენეჯერი ხსნის.' };
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'ჩაწერე სახელი.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stocktakes')
    .insert({ company_id: session.company.id, name, created_by: session.userId })
    .select('id')
    .single();
  if (error) return { error: error.message };
  redirect(`/count/${data.id}`);
}

/**
 * The counter scans or types a shelf code. The zone is claimed for them, or
 * reopened if it is already theirs; someone else's zone is refused.
 */
export async function openZone(stocktakeId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'დაასკანერე ან ჩაწერე თაროს კოდი.' };

  const supabase = await createClient();
  const { data: location } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('company_id', session.company.id)
    .ilike('code', code)
    .maybeSingle<{ id: string; code: string; name: string }>();
  if (!location) return { error: `ლოკაცია „${code}“ ვერ მოიძებნა.` };

  const { data: zone } = await supabase
    .from('stocktake_zones')
    .select('id, counter_id, status')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', location.id)
    .maybeSingle<{ id: string; counter_id: string | null; status: string }>();

  if (zone) {
    if (zone.counter_id !== session.userId && !isManager(session.profile.role)) {
      const { data: who } = await supabase
        .from('user_profiles')
        .select('full_name, email')
        .eq('id', zone.counter_id ?? '')
        .maybeSingle<{ full_name: string | null; email: string }>();
      return { error: `ამ ზონას ითვლის ${who?.full_name ?? who?.email ?? 'სხვა თანამშრომელი'}.` };
    }
    if (zone.status === 'done') {
      await supabase.from('stocktake_zones').update({ status: 'counting', done_at: null }).eq('id', zone.id);
    }
  } else {
    const { error } = await supabase.from('stocktake_zones').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: location.id,
      counter_id: session.userId,
    });
    if (error) {
      return { error: error.code === '23505' ? 'ამ ზონას უკვე სხვა ითვლის.' : error.message };
    }
  }
  redirect(`/count/${stocktakeId}/${location.id}`);
}

export type ProductHit = Pick<Product, 'id' | 'sku' | 'barcode' | 'name' | 'variant' | 'unit'>;

/** Exact barcode or SKU first; otherwise a name search. */
export async function findProducts(query: string): Promise<ProductHit[]> {
  const session = await requireSession();
  const q = query.trim();
  if (!q) return [];
  const supabase = await createClient();
  const cols = 'id, sku, barcode, name, variant, unit';
  const { data: exact } = await supabase
    .from('products')
    .select(cols)
    .eq('company_id', session.company.id)
    .or(`barcode.eq.${q.replace(/[,()]/g, '')},sku.ilike.${q.replace(/[,()%]/g, '')}`)
    .limit(5);
  if (exact && exact.length) return exact as ProductHit[];
  const { data } = await supabase
    .from('products')
    .select(cols)
    .eq('company_id', session.company.id)
    .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
    .order('name')
    .limit(8);
  return (data ?? []) as ProductHit[];
}

export type EntryInput = {
  productId: string | null;
  unknownLabel: string | null;
  quantity: number;
  boxes: number | null;
  perBox: number | null;
};

export async function addEntry(stocktakeId: string, locationId: string, input: EntryInput): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  if (!Number.isFinite(input.quantity) || input.quantity < 0) return { error: 'რაოდენობა არასწორია.' };
  if (!input.productId && !input.unknownLabel?.trim()) return { error: 'აირჩიე პროდუქტი ან აღწერე.' };

  const supabase = await createClient();
  const { error } = await supabase.from('stocktake_entries').insert({
    company_id: session.company.id,
    stocktake_id: stocktakeId,
    location_id: locationId,
    product_id: input.productId,
    unknown_label: input.productId ? null : input.unknownLabel!.trim(),
    quantity: input.quantity,
    boxes: input.boxes,
    per_box: input.perBox,
    counter_id: session.userId,
  });
  if (error) return { error: error.message.includes('closed') ? 'ინვენტარიზაცია დახურულია.' : error.message };
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  return { notice: 'ჩაიწერა' };
}

export async function deleteEntry(stocktakeId: string, locationId: string, entryId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.from('stocktake_entries').delete().eq('id', entryId);
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
}

export async function closeZone(stocktakeId: string, locationId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase
    .from('stocktake_zones')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId);
  revalidatePath(`/count/${stocktakeId}`);
  redirect(`/count/${stocktakeId}`);
}
