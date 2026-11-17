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
 * Change a warehouse's address, or its name while nothing refers to it yet.
 * Stocktakes and count cycles name their warehouse by text, so a warehouse
 * already counted keeps its name (renaming it would split its count in two).
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
    const old = site.name.replace(/"/g, '\\"');
    const [{ count: taken }, { count: used }] = await Promise.all([
      supabase
        .from('sites')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .eq('name', name),
      supabase
        .from('stocktakes')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .or(`branch.eq."${old}",client_name.eq."${old}",name.eq."${old}"`),
    ]);
    if (taken) return { error: `„${name}“ უკვე არსებობს.` };
    if (used)
      return {
        error: `„${site.name}“-ზე უკვე ${used} ინვენტარიზაციაა — სახელის შეცვლა მათ დათვლას გაყოფს. მისამართი შეგიძლია შეცვალო.`,
      };
  }
  const { error } = await supabase
    .from('sites')
    .update({ name, address })
    .eq('id', id)
    .eq('company_id', company.id);
  if (error) return { error: error.message };
  revalidatePath('/manage/sites');
  return { notice: '✓ შეინახა' };
}
