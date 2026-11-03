import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import OnboardingForm from './onboarding-form';

export const metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile) redirect('/dashboard');

  return (
    <main className="grid-wash flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Name your workspace</h1>
        <p className="mt-2 text-sm text-ink-faint">
          Everything in Inverse — products, locations and verification history — belongs to
          one company. You can invite colleagues to it once it exists.
        </p>
        <div className="mt-6 rounded-control border border-rule/70 bg-paper-sunk/70 p-6">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
