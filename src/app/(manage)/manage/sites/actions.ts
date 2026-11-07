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

export async function importSites(rows: { name: string; address: string }[]): Promise<FormState> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'მხოლოდ მენეჯერს შეუძლია.' };
  const seen = new Set<string>();
  const clean = rows
    .map((r) => ({ name: r.name.trim(), address: r.address.trim() }))
    .filter((r) => r.name && !seen.has(r.name) && seen.add(r.name))
    .map((r) => ({ company_id: company.id, name: r.name, address: r.address || null }));
  if (!clean.length) return { error: 'ფაილში სახელები ვერ ვიპოვე.' };
  const supabase = await createClient();
  const { error } = await supabase.from('sites').upsert(clean, { onConflict: 'company_id,name' });
  if (error) return { error: error.message };
  revalidatePath('/manage/sites');
  return { notice: `ჩაიტვირთა ${clean.length} საწყობი / ობიექტი.` };
}

export async function deleteSite(id: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.from('sites').delete().eq('id', id);
  revalidatePath('/manage/sites');
}
