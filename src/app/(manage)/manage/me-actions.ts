'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

const THEME_COOKIE = 'inv_theme';

/** Light or dark dashboard, kept on this device for a year. */
export async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  (await cookies()).set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
  });
  revalidatePath('/manage', 'layout');
}

/** Every notification the person can see, marked read. */
export async function markAllRead(): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from('app_notifications').select('id').limit(500);
  const rows = (data ?? []).map((n) => ({ notification_id: n.id as string }));
  if (rows.length)
    await supabase
      .from('app_notification_reads')
      .upsert(rows, { onConflict: 'user_id,notification_id', ignoreDuplicates: true });
  revalidatePath('/manage', 'layout');
}

/** The person's own name. */
export async function updateMyName(formData: FormData): Promise<void> {
  const { userId } = await requireSession();
  const name = String(formData.get('full_name') ?? '')
    .trim()
    .slice(0, 120);
  if (!name) return;
  const supabase = await createClient();
  await supabase.from('user_profiles').update({ full_name: name }).eq('id', userId);
  revalidatePath('/manage', 'layout');
}
