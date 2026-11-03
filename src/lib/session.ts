import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { Company, UserProfile } from '@/types/database';

export type Session = {
  userId: string;
  profile: UserProfile;
  company: Company;
  canWrite: boolean;
};

/**
 * Loads the signed-in user's profile and company.
 * Sends users without a session to /login and users without a company to /onboarding.
 */
export async function requireSession(): Promise<Session> {
  if (!isSupabaseConfigured()) redirect('/login');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<UserProfile>();

  if (!profile) redirect('/onboarding');

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', profile.company_id)
    .maybeSingle<Company>();

  if (!company) redirect('/onboarding');

  return {
    userId: user.id,
    profile,
    company,
    canWrite: profile.role !== 'viewer',
  };
}
