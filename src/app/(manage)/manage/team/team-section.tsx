import { appUrlFrom } from '@/lib/app-url';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { CompanyInvite, UserProfile } from '@/types/database';
import InviteForm from './invite-form';
import AddDrawer from '@/components/add-drawer';
import TeamGrid, { type TeamRow } from './team-grid';

/** Staff: invite counters and managers, their modules, open invites, remove access. */
export default async function TeamSection() {
  const { userId, profile, company } = await requireSession();
  const supabase = await createClient();
  const h = await headers();
  const appUrl = appUrlFrom(h);

  const [{ data: team }, { data: invites }] = await Promise.all([
    supabase.from('user_profiles').select('*').order('created_at').returns<UserProfile[]>(),
    supabase
      .from('company_invites')
      .select('*')
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .returns<CompanyInvite[]>(),
  ]);
  const active = (team ?? []).filter((m) => !m.disabled_at);
  const removed = (team ?? []).filter((m) => m.disabled_at);
  const canRemove = (m: UserProfile) =>
    m.id !== userId && m.role !== 'owner' && !(profile.role === 'admin' && m.role === 'admin');

  const rows: TeamRow[] = [
    ...active.map((m) => ({
      id: m.id,
      state: 'member' as const,
      name: m.full_name ?? m.email,
      email: m.email,
      role: m.role,
      modules: (m.modules ?? []) as string[],
      canOpen: !!m.can_open,
      canSeeBook: m.can_see_book ?? true,
      me: m.id === userId,
      editable: canRemove(m),
    })),
    ...(invites ?? []).map((i) => ({
      id: i.id,
      state: 'invite' as const,
      name: '—',
      email: i.email,
      role: i.role,
      modules: [],
      canOpen: false,
      canSeeBook: false,
      me: false,
      editable: true,
    })),
    ...removed.map((m) => ({
      id: m.id,
      state: 'removed' as const,
      name: m.full_name ?? m.email,
      email: m.email,
      role: m.role,
      modules: [],
      canOpen: false,
      canSeeBook: false,
      me: false,
      editable: canRemove(m),
    })),
  ];

  return (
    <section id="team" className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">გუნდი და როლები</h2>
        {/* "+" on the right above the list: invite someone, in a drawer. */}
        <div className="ml-auto">
          <AddDrawer title="თანამშრომლის მოწვევა" label="მოწვევა">
            <InviteForm appUrl={appUrl} company={company.name} isOwner={profile.role === 'owner'} />
          </AddDrawer>
        </div>
      </div>
      <TeamGrid rows={rows} owner={profile.role === 'owner'} />
    </section>
  );
}
