import { appUrlFrom } from '@/lib/app-url';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { CompanyInvite, UserProfile } from '@/types/database';
import InviteForm from './invite-form';
import AddDrawer from '@/components/add-drawer';
import { cancelInvite, removeMember, restoreMember, setModules } from './actions';

const ROLE: Record<string, string> = {
  owner: 'მფლობელი',
  admin: 'მენეჯერი',
  member: 'აღწერის თანამშრომელი',
  viewer: 'მნახველი',
};
const MOD: [string, string][] = [
  ['assets', '🏷 ძირ. საშუალებები'],
  ['stock', '📦 მარაგები'],
  ['expiry', '⏳ ვადიანი'],
];

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

  return (
    <section id="team" className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">თანამშრომლები</h2>
        {/* "+" on the right above the list: invite someone, in a drawer. */}
        <div className="ml-auto">
          <AddDrawer title="თანამშრომლის მოწვევა" label="მოწვევა">
            <InviteForm appUrl={appUrl} company={company.name} isOwner={profile.role === 'owner'} />
          </AddDrawer>
        </div>
      </div>
      <details open className="rounded-control border border-rule p-4">
        <summary className="cursor-pointer text-sm font-semibold text-accent">
          სია და ცვლილებები ({active.length})
        </summary>
        <div className="mt-3 grid gap-4">
          <ul className="grid gap-2">
            {active.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-rule/70 px-3 py-2 text-sm"
              >
                {/* One line per person: name · email · role, modules, save, remove. */}
                <span className="min-w-0 flex-1 truncate">
                  <b>{m.full_name ?? m.email}</b>
                  {m.id === userId && <span className="text-ink-faint"> (შენ)</span>}
                  <span className="text-ink-faint">
                    {' '}
                    · {m.email} · {ROLE[m.role]}
                  </span>
                </span>
                {m.role === 'member' && (
                  <form
                    action={setModules.bind(null, m.id)}
                    className="flex shrink-0 items-center gap-2"
                  >
                    {MOD.map(([k, v]) => (
                      <label key={k} title={v} className="flex items-center gap-0.5">
                        <input
                          type="checkbox"
                          name="modules"
                          value={k}
                          defaultChecked={(m.modules ?? []).includes(k as never)}
                        />
                        {v.split(' ')[0]}
                      </label>
                    ))}
                    <label
                      title="ინვენტარიზაციის გახსნის უფლება"
                      className="flex items-center gap-0.5"
                    >
                      <input
                        type="checkbox"
                        name="can_open"
                        value="1"
                        defaultChecked={m.can_open}
                      />
                      ➕
                    </label>
                    <label
                      title="ნაშთის ხედვის უფლება — დათვლისას უჩანს, რამდენი უნდა იყოს"
                      className="flex items-center gap-0.5"
                    >
                      <input
                        type="checkbox"
                        name="can_see_book"
                        value="1"
                        defaultChecked={m.can_see_book ?? true}
                      />
                      👁
                    </label>
                    <button
                      type="submit"
                      className="rounded-control border border-rule-strong px-2 py-0.5 text-xs"
                    >
                      შენახვა
                    </button>
                  </form>
                )}
                {canRemove(m) && (
                  <form action={removeMember.bind(null, m.id)} className="shrink-0">
                    <button
                      type="submit"
                      title="შესვლას ვეღარ შეძლებს; სახელი ძველ აქტებზე რჩება. დაბრუნება შეიძლება."
                      className="rounded-control border border-mismatch/40 px-2 py-0.5 text-xs text-mismatch"
                    >
                      დეაქტივაცია
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {(invites ?? []).length > 0 && (
            <div className="grid gap-2">
              <h2 className="text-sm font-semibold text-review">
                ⏳ მოლოდინში (ჯერ არ დარეგისტრირებულა)
              </h2>
              <ul className="grid gap-2">
                {(invites ?? []).map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded-control border border-dashed border-review/70 bg-review/10 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {i.email} · {ROLE[i.role]}
                    </span>
                    <form action={cancelInvite.bind(null, i.id)}>
                      <button type="submit" className="text-xs text-review underline">
                        გაუქმება
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {removed.length > 0 && (
            <div className="grid gap-1 text-sm text-ink-faint">
              <h2 className="font-semibold">დეაქტივირებული (სახელი რჩება ძველ აქტებზე)</h2>
              {removed.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {m.full_name ?? m.email} · {m.email}
                  </span>
                  {canRemove(m) && (
                    <form action={restoreMember.bind(null, m.id)}>
                      <button
                        type="submit"
                        className="rounded-control border border-match/50 px-2 py-0.5 text-xs text-match"
                      >
                        ↺ გააქტიურება
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
