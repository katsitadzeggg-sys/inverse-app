'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

/**
 * Closes a warehouse's count cycle (a quarter): its open stocktakes are closed
 * and every product's result is frozen for analytics. The warehouse's next
 * stocktake starts a new cycle with its own missed / to re-check.
 */
export async function closeCycle(cycleId: string): Promise<{ error?: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'ციკლს მხოლოდ მფლობელი ან მენეჯერი ხურავს.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('close_count_cycle', { p_cycle: cycleId });
  if (error)
    return {
      error: /already closed/.test(error.message)
        ? 'ეს ციკლი უკვე დახურულია.'
        : `ვერ დაიხურა: ${error.message.slice(0, 150)}`,
    };
  revalidatePath('/manage/cycles');
  revalidatePath('/manage/stocktakes');
  revalidatePath('/manage');
  return {};
}

/** How often the company counts — only names its cycles. */
export async function setCyclePeriod(period: string): Promise<{ error?: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return { error: 'მხოლოდ მენეჯერი.' };
  if (!['month', 'quarter', 'half', 'year'].includes(period)) return { error: 'პერიოდი?' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('companies')
    .update({ cycle_period: period })
    .eq('id', profile.company_id);
  if (error) return { error: error.message };
  revalidatePath('/manage/cycles');
  revalidatePath('/manage/stocktakes');
  return {};
}

const ka = (m: string) =>
  /open cycle exists/.test(m)
    ? 'ამ საწყობს უკვე აქვს ღია ციკლი — ჯერ ის დახურე.'
    : /close it first/.test(m)
      ? 'არქივში მხოლოდ დახურული ციკლი გადადის.'
      : m.slice(0, 150);

/** The manager starts a named cycle for a warehouse (none may be open there). */
export async function createCycle(formData: FormData): Promise<{ error?: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return { error: 'მხოლოდ მენეჯერი.' };
  const warehouse = String(formData.get('warehouse') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  if (!warehouse) return { error: 'აირჩიე საწყობი.' };
  if (!name) return { error: 'ჩაწერე ციკლის სახელი.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_count_cycle', {
    p_warehouse: warehouse,
    p_name: name,
  });
  if (error) return { error: ka(error.message) };
  revalidatePath('/manage/cycles');
  revalidatePath('/manage/stocktakes');
  return {};
}

/** Rename a cycle, or move a closed one to the archive (or back). */
export async function updateCycle(
  cycleId: string,
  patch: { name?: string; archived?: boolean },
): Promise<{ error?: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return { error: 'მხოლოდ მენეჯერი.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_count_cycle', {
    p_cycle: cycleId,
    p_name: patch.name ?? null,
    p_archived: patch.archived ?? null,
  });
  if (error) return { error: ka(error.message) };
  revalidatePath('/manage/cycles');
  revalidatePath('/manage/stocktakes');
  return {};
}
