'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { FormState } from '@/app/(count)/count/actions';

const num = (v: FormDataEntryValue | null) =>
  v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

export async function addSite(_prev: FormState, formData: FormData): Promise<FormState> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'მხოლოდ მენეჯერს შეუძლია.' };
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'ჩაწერე საწყობის / ობიექტის სახელი.' };
  const supabase = await createClient();
  const { error } = await supabase.from('sites').upsert(
    {
      company_id: company.id,
      name,
      address: String(formData.get('address') ?? '').trim() || null,
      lat: num(formData.get('lat')),
      lng: num(formData.get('lng')),
    },
    { onConflict: 'company_id,name' },
  );
  if (error) return { error: error.message };
  revalidatePath('/manage/sites');
  return { notice: `✓ ${name} დაემატა` };
}

/**
 * A warehouse is deleted only when none of its stocktakes is left in the list
 * (archived ones do not count): otherwise its acts would lose their warehouse.
 */
export async function deleteSite(id: string): Promise<FormState> {
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'მხოლოდ მენეჯერს შეუძლია.' };
  const supabase = await createClient();
  const { data: site } = await supabase.from('sites').select('name').eq('id', id).maybeSingle();
  if (!site) return { error: 'ვერ მოიძებნა.' };
  const { count } = await supabase
    .from('stocktakes')
    .select('id', { count: 'exact', head: true })
    .eq('branch', site.name)
    .is('archived_at', null);
  if (count)
    return {
      error: `„${site.name}“-ს ${count} ინვენტარიზაცია აქვს. ჯერ ისინი გადაიტანე არქივში, მერე წაშალე.`,
    };
  const { error } = await supabase.from('sites').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/manage/sites');
  return { notice: '✓ წაიშალა' };
}

/**
 * Rename a warehouse / change its address. Its stocktakes name it by text
 * (branch), so they are renamed with it, or the list and map would lose them.
 */
export async function editSite(id: string, formData: FormData): Promise<FormState> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'მხოლოდ მენეჯერს შეუძლია.' };
  const name = String(formData.get('name') ?? '').trim();
  const address = String(formData.get('address') ?? '').trim() || null;
  if (!name) return { error: 'სახელი ცარიელი ვერ იქნება.' };
  const supabase = await createClient();
  const { data: site } = await supabase
    .from('sites')
    .select('name')
    .eq('id', id)
    .eq('company_id', company.id)
    .maybeSingle();
  if (!site) return { error: 'ვერ მოიძებნა.' };
  if (name !== site.name) {
    const { count } = await supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('name', name);
    if (count) return { error: `„${name}“ უკვე არსებობს.` };
  }
  const { error } = await supabase
    .from('sites')
    .update({ name, address })
    .eq('id', id)
    .eq('company_id', company.id);
  if (error) return { error: error.message };
  if (name !== site.name) {
    const { error: e2 } = await supabase
      .from('stocktakes')
      .update({ branch: name })
      .eq('company_id', company.id)
      .eq('branch', site.name);
    if (e2)
      return { error: `სახელი შეიცვალა, მაგრამ ინვენტარიზაციები ვერ განახლდა: ${e2.message}` };
  }
  revalidatePath('/manage/sites');
  revalidatePath('/manage/stocktakes');
  return { notice: '✓ შეინახა' };
}
