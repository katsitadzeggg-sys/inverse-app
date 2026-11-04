import Link from 'next/link';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { CompanyInvite, UserProfile } from '@/types/database';
import InviteForm from './invite-form';
import { cancelInvite, removeMember } from './actions';

export const metadata = { title: 'გუნდი' };

const ROLE: Record<string, string> = { owner: 'მფლობელი', admin: 'მენეჯერი', member: 'აღმწერი', viewer: 'მნახველი' };

/** The team: invite counters and managers, see open invites, remove access. */
export default async function TeamPage() {
  const { userId, profile, company } = await requireSession();
  const supabase = await createClient();
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;

  const [{ data: team }, { data: invites }] = await Promise.all([
    supabase.from('user_profiles').select('*').order('created_at').returns<UserProfile[]>(),
    supabase.from('company_invites').select('*').is('accepted_at', null).order('created_at', { ascending: false }).returns<CompanyInvite[]>(),
  ]);
  const active = (team ?? []).filter((m) => !m.disabled_at);
  const removed = (team ?? []).filter((m) => m.disabled_at);
  const canRemove = (m: UserProfile) =>
    m.id !== userId && m.role !== 'owner' && !(profile.role === 'admin' && m.role === 'admin');

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <section className="grid content-start gap-4">
        <div>
          <Link href="/manage" className="text-sm text-ink-faint">← ინვენტარიზაციები</Link>
          <h1 className="mt-1 text-xl font-semibold">გუნდი</h1>
        </div>

        <ul className="grid gap-2">
          {active.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-control border border-rule/70 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{m.full_name ?? m.email}{m.id === userId && <span className="text-ink-faint"> (შენ)</span>}</p>
                <p className="truncate text-xs text-ink-faint">{m.email} · {ROLE[m.role]}</p>
              </div>
              {canRemove(m) && (
                <form action={removeMember.bind(null, m.id)}>
                  <button type="submit" className="rounded-control border border-mismatch/40 px-3 py-1.5 text-xs text-mismatch">მოხსნა</button>
                </form>
              )}
            </li>
          ))}
        </ul>

        {(invites ?? []).length > 0 && (
          <div className="grid gap-2">
            <h2 className="text-sm font-semibold">მოლოდინში (ჯერ არ დარეგისტრირებულა)</h2>
            <ul className="grid gap-2">
              {(invites ?? []).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-control border border-dashed border-rule-strong px-4 py-2 text-sm">
                  <span className="min-w-0 truncate">{i.email} · {ROLE[i.role]}</span>
                  <form action={cancelInvite.bind(null, i.id)}>
                    <button type="submit" className="text-xs text-ink-faint underline">გაუქმება</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {removed.length > 0 && (
          <div className="grid gap-1 text-sm text-ink-faint">
            <h2 className="font-semibold">მოხსნილი (სახელი რჩება ძველ აქტებზე)</h2>
            {removed.map((m) => <p key={m.id}>{m.full_name ?? m.email} · {m.email}</p>)}
            <p className="text-xs">დასაბრუნებლად ხელახლა მოიწვიე იმავე მეილზე.</p>
          </div>
        )}
      </section>

      <InviteForm appUrl={appUrl} company={company.name} isOwner={profile.role === 'owner'} />
    </div>
  );
}
