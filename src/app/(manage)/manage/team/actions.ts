'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type InviteState = { error?: string; notice?: string };

const ROLES = new Set(['member', 'admin']);

/** Owner/admin invites a counter (member) or manager (admin) by email. */
export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { userId, profile, company } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'მოწვევა მხოლოდ მენეჯერს შეუძლია.' };

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const role = String(formData.get('role') ?? 'member');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'მეილი არასწორია.' };
  if (!ROLES.has(role)) return { error: 'როლი აირჩიე.' };
  if (role === 'admin' && profile.role !== 'owner')
    return { error: 'მენეჯერის მოწვევა მხოლოდ მფლობელს შეუძლია.' };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('id, disabled_at')
    .eq('email', email)
    .maybeSingle<{ id: string; disabled_at: string | null }>();
  if (existing && !existing.disabled_at) return { error: 'ეს ადამიანი უკვე გუნდშია.' };

  // Replace an older open invite for the same email.
  await supabase.from('company_invites').delete().eq('email', email).is('accepted_at', null);
  const all = ['stock', 'expiry', 'assets'];
  const modules =
    role === 'admin'
      ? all
      : formData
          .getAll('modules')
          .map(String)
          .filter((m) => all.includes(m));
  if (!modules.length) return { error: 'აღმწერს ერთი მოდული მაინც მოუნიშნე.' };
  const { error } = await supabase
    .from('company_invites')
    .insert({ company_id: company.id, email, role, modules, invited_by: userId });
  if (error) return { error: error.message };

  revalidatePath('/manage/sites');
  return { notice: email };
}

export async function cancelInvite(id: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.from('company_invites').delete().eq('id', id).is('accepted_at', null);
  revalidatePath('/manage/sites');
}

export async function removeMember(id: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.rpc('remove_team_member', { p_user: id });
  revalidatePath('/manage/sites');
}

/** Which modules a counter may count in. */
export async function setModules(id: string, formData: FormData): Promise<void> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return;
  const all = ['stock', 'expiry', 'assets'];
  const modules = formData
    .getAll('modules')
    .map(String)
    .filter((m) => all.includes(m));
  if (!modules.length) return;
  const supabase = await createClient();
  await supabase
    .from('user_profiles')
    .update({ modules, can_open: formData.get('can_open') === '1' })
    .eq('id', id)
    .eq('role', 'member');
  revalidatePath('/manage/sites');
}
