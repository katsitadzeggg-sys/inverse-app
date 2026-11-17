'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

export type AuthState = { error?: string; notice?: string };

/** The link in an email comes back to this deployment, not the project's default Site URL. */
async function originOf() {
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
}

/** Supabase's common sign-in messages in Georgian; anything else as it came. */
function ka(message: string) {
  if (/invalid login credentials/i.test(message)) return 'ელფოსტა ან პაროლი არასწორია.';
  if (/email not confirmed/i.test(message))
    return 'ელფოსტა ჯერ არ არის დადასტურებული — გახსენი წერილის ბმული.';
  if (/already registered|already been registered/i.test(message))
    return 'ეს ელფოსტა უკვე რეგისტრირებულია — შედი ან აღადგინე პაროლი.';
  if (/rate limit|too many/i.test(message)) return 'ძალიან ბევრი მცდელობა. სცადე რამდენიმე წუთში.';
  return message;
}

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
  if (!email || !password) return { error: 'ჩაწერე ელფოსტა და პაროლი.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: ka(error.message) };

  const next = String(formData.get('next') ?? '') || '/count';
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const { email, password } = readCredentials(formData);
  const fullName = String(formData.get('full_name') ?? '').trim();
  const companyName = String(formData.get('company_name') ?? '').trim();

  if (!email || !password) return { error: 'ჩაწერე ელფოსტა და პაროლი.' };
  if (password.length < 8) return { error: 'პაროლი მინიმუმ 8 სიმბოლო უნდა იყოს.' };
  if (password !== String(formData.get('password2') ?? ''))
    return { error: 'პაროლები ერთმანეთს არ ემთხვევა.' };
  if (!companyName) return { error: 'ჩაწერე კომპანიის სახელი.' };

  const origin = await originOf();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, company_name: companyName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) return { error: ka(error.message) };

  // With email confirmation enabled Supabase returns a user but no session.
  if (!data.session) {
    return { notice: 'შეამოწმე ელფოსტა: დაადასტურე მისამართი ბმულით და მერე შედი.' };
  }

  revalidatePath('/', 'layout');
  redirect('/onboarding');
}

/** "Forgot password": Supabase emails a link that signs in and opens /auth/reset. */
export async function requestReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'ჩაწერე ელფოსტა.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await originOf()}/auth/callback?next=/auth/reset`,
  });
  if (error) return { error: ka(error.message) };
  // The same answer whether or not the address has an account.
  return { notice: 'თუ ეს ელფოსტა რეგისტრირებულია, წერილი გაიგზავნა — გახსენი ბმული.' };
}

/** The new password, set from the reset link's session. */
export async function setNewPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) return { error: 'პაროლი მინიმუმ 8 სიმბოლო უნდა იყოს.' };
  if (password !== String(formData.get('password2') ?? ''))
    return { error: 'პაროლები ერთმანეთს არ ემთხვევა.' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'ბმულს ვადა გაუვიდა. მოითხოვე ახალი „პაროლის აღდგენით“.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: ka(error.message) };
  revalidatePath('/', 'layout');
  redirect('/count');
}
