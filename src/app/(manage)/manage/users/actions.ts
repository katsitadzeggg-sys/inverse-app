'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

const ROLES = new Set(['admin', 'member', 'viewer']);

/** Platform admin changes one person's role or removes / restores access. */
export async function setAccess(userId: string, formData: FormData): Promise<void> {
  await requireSession();
  const role = String(formData.get('role') ?? '');
  const disabled = formData.get('disabled') === '1';
  if (!ROLES.has(role)) return;
  const supabase = await createClient();
  await supabase.rpc('platform_set_access', { p_user: userId, p_role: role, p_disabled: disabled });
  revalidatePath('/manage/users');
}
