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
