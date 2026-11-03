'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type OnboardingState = { error?: string };

export async function createCompany(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get('company_name') ?? '').trim();
  if (name.length < 2) return { error: 'Enter your company name.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // `companies` has no INSERT policy — tenant creation only happens through this RPC.
  const { error } = await supabase.rpc('create_company_for_current_user', {
    company_name: name,
    company_slug: null,
  });

  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
