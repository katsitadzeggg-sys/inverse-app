import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Set up your workspace' };

/**
 * First stop after sign-up. Someone invited by email joins that company
 * straight away (counters land on /count); a removed person sees why they are
 * out; anyone else is told to ask for an invite.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: status } = await supabase.rpc('accept_company_invite');
  if (status === 'member' || status === 'joined') redirect('/count');

  if (status === 'disabled') {
    return (
      <main className="grid-wash flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight">წვდომა გაუქმებულია</h1>
          <p className="mt-2 text-sm text-ink-soft">
            კომპანიის მენეჯერმა წვდომა მოგიხსნა. თუ ეს შეცდომაა, სთხოვე, ხელახლა მოგიწვიოს იმავე
            მეილზე ({user.email}).
          </p>
          <form action="/auth/signout" method="post" className="mt-6">
            <button
              type="submit"
              className="rounded-control border border-rule-strong px-4 py-2 text-sm"
            >
              გასვლა
            </button>
          </form>
        </div>
      </main>
    );
  }

  // New companies are opened by Inverse (Platform), not by sign-up: without
  // an invite there is nothing to join here.
  return (
    <main className="grid-wash flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">მოწვევა საჭიროა</h1>
        <p className="mt-2 text-sm text-ink-soft">
          ამ მეილზე ({user.email}) მოწვევა არ მოიძებნა. სთხოვე მენეჯერს, ზუსტად ამ მეილზე მოგიწვიოს,
          და თავიდან შედი. ახალი კომპანიის გასახსნელად დაგვიკავშირდი: info@inverse.ge
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-control border border-rule-strong px-4 py-2 text-sm"
          >
            გასვლა
          </button>
        </form>
      </div>
    </main>
  );
}
