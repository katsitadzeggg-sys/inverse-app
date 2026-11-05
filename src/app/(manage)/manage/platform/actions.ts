'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type PlatformState = { error?: string; notice?: string };

const MODULES = ['stock', 'expiry', 'assets'];
const modulesFrom = (fd: FormData) => fd.getAll('modules').map(String).filter((m) => MODULES.includes(m));

/** A new client company with the email of its manager. */
export async function createCompany(_prev: PlatformState, formData: FormData): Promise<PlatformState> {
  await requireSession();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (name.length < 2) return { error: 'ჩაწერე კომპანიის სახელი.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'მენეჯერის მეილი არასწორია.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('platform_create_company', { p_name: name, p_manager_email: email });
  if (error) return { error: error.message };
  revalidatePath('/manage/platform');
  redirect(`/manage/platform/${data}?created=1`);
}

/** Invite a manager or a counter into a company. */
export async function invite(companyId: string, _prev: PlatformState, formData: FormData): Promise<PlatformState> {
  await requireSession();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'member');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'მეილი არასწორია.' };
  if (!['admin', 'member'].includes(role)) return { error: 'როლი აირჩიე.' };
  const modules = role === 'admin' ? MODULES : modulesFrom(formData);
  if (!modules.length) return { error: 'აღმწერს ერთი მოდული მაინც მოუნიშნე.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_invite', { p_company: companyId, p_email: email, p_role: role, p_modules: modules });
  if (error) return { error: error.message };
  revalidatePath(`/manage/platform/${companyId}`);
  return { notice: email };
}

/** Role, modules and access of one person. */
export async function setMember(companyId: string, userId: string, formData: FormData): Promise<void> {
  await requireSession();
  const role = String(formData.get('role') ?? '');
  const disabled = formData.get('disabled') === '1';
  const supabase = await createClient();
  await supabase.rpc('platform_set_member', {
    p_user: userId,
    p_role: role,
    p_modules: modulesFrom(formData),
    p_disabled: disabled,
  });
  revalidatePath(`/manage/platform/${companyId}`);
}
