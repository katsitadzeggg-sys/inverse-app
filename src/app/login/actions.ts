'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

export type AuthState = { error?: string; notice?: string };

const NOT_CONFIGURED =
  'This deployment has no Supabase project connected, so accounts are unavailable. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.';

function readCredentials(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  return { email, password };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  const next = String(formData.get('next') ?? '') || '/dashboard';
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const { email, password } = readCredentials(formData);
  const fullName = String(formData.get('full_name') ?? '').trim();

  if (!email || !password) return { error: 'Enter your email and a password.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) return { error: error.message };

  // With email confirmation enabled Supabase returns a user but no session.
  if (!data.session) {
    return { notice: 'Check your inbox to confirm your address, then sign in.' };
  }

  revalidatePath('/', 'layout');
  redirect('/onboarding');
}
