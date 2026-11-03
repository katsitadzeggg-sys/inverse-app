import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card } from '@/components/ui';
import type { UserProfile } from '@/types/database';
import SettingsForms from './settings-forms';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { company, profile } = await requireSession();
  const supabase = await createClient();

  const { data: team } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at')
    .returns<UserProfile[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Workspace {company.slug} · {company.plan} plan · {company.currency}
        </p>
      </div>

      <SettingsForms
        companyName={company.name}
        canAdmin={profile.role === 'owner' || profile.role === 'admin'}
      />

      <Card title="Team">
        <ul className="divide-y divide-rule/70">
          {(team ?? []).map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{member.full_name ?? member.email}</p>
                <p className="text-xs text-ink-faint">{member.email}</p>
              </div>
              <span className="rounded-full bg-paper-sunk px-2.5 py-0.5 text-xs capitalize text-ink-soft">
                {member.role}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-faint">
          Colleagues join by signing up and being added to this workspace by an owner or
          admin. Invitations are not wired up yet.
        </p>
      </Card>
    </div>
  );
}
