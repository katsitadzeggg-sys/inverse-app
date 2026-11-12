'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

/**
 * A form of a warehouse: a stocktake with only its "missed" products (counted
 * nowhere) or only its "to re-check" ones (the re-count replaces the earlier
 * counts). Opens the existing one if it is still open.
 */
export async function openPoolForm(
  ids: string[],
  kind: 'missed' | 'review',
): Promise<{ error: string }> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'ფორმას მხოლოდ მფლობელი ან ადმინი ქმნის.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_pool_form', { p_ids: ids, p_kind: kind });
  if (error || !data)
    return {
      error: /no book/.test(error?.message ?? '')
        ? 'ნაშთი ჩატვირთული არ არის.'
        : 'ფორმა ვერ შეიქმნა. სცადე თავიდან.',
    };
  redirect(`/manage/${data as string}`);
}
