import { cache } from 'react';
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
 *
 * Once per request (layout and page share it). The proxy has already checked
 * the session with Supabase, so the token is read locally (getClaims), and the
 * profile comes with its company in one query.
 */
export const requireSession = cache(async (): Promise<Session> => {
  if (!isSupabaseConfigured()) redirect('/login');

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect('/login');

  const { data: row } = await supabase
    .from('user_profiles')
    .select('*, company:companies!user_profiles_company_id_fkey(*)')
    .eq('id', userId)
    .maybeSingle<UserProfile & { company: Company | null }>();

  if (!row) redirect('/onboarding');
  const { company, ...profile } = row;
  if (!company) redirect('/onboarding');

  return {
    userId,
    profile: profile as UserProfile,
    company,
    canWrite: profile.role !== 'viewer',
  };
});
