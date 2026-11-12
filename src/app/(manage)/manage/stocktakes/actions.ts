'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

/**
 * The "missed" form of a warehouse: a stocktake with only the products its
 * stocktakes counted nowhere. Opens the existing one if it is still open.
 */
export async function openMissedForm(ids: string[]): Promise<{ error: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'ფორმას მხოლოდ მფლობელი ან ადმინი ქმნის.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_missed_form', { p_ids: ids });
  if (error || !data)
    return {
      error: /no book/.test(error?.message ?? '')
        ? 'ნაშთი ჩატვირთული არ არის.'
        : 'ფორმა ვერ შეიქმნა. სცადე თავიდან.',
    };
  redirect(`/manage/${data as string}`);
}
