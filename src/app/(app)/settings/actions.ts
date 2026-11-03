'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type SettingsState = { error?: string; notice?: string };

export async function renameCompany(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') {
    return { error: 'Only an owner or admin can rename the workspace.' };
  }

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Enter a company name.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('companies')
    .update({ name })
    .eq('id', profile.company_id);

  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return { notice: 'Workspace renamed.' };
}

export async function loadDemoData(
  _prev: SettingsState,
  _formData: FormData,
): Promise<SettingsState> {
  const { canWrite } = await requireSession();
  if (!canWrite) return { error: 'Your role is read-only.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('seed_demo_data');

  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return {
    notice:
      'Demo catalogue loaded. It is skipped if you already had products, so nothing was overwritten.',
  };
}
