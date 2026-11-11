import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { setMember } from '../actions';
import InviteForm, { MODULE_LABEL } from './invite-form';

type Member = {
  user_id: string;
  email: string;
  full_name: string | null;
  company_id: string | null;
  company_name: string | null;
  role: string | null;
  modules: string[] | null;
  can_open?: boolean;
  disabled_at: string | null;
  registered_at: string;
  confirmed: boolean;
  last_sign_in_at: string | null;
};
type Invite = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  modules: string[];
  created_at: string;
};

const ROLE: Record<string, string> = {
  owner: 'მფლობელი',
  admin: 'მენეჯერი',
  member: 'აღწერის თანამშრომელი',
  viewer: 'მნახველი',
};
const when = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('ka-GE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

function Person({ m, company }: { m: Member; company: string }) {
  return (
    <li
      className={`grid gap-2 rounded-control border border-rule/70 p-3 ${m.disabled_at ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-medium">{m.full_name ?? m.email}</p>
          <p className="text-xs text-ink-faint">
            {m.email} · ბოლო შესვლა: {when(m.last_sign_in_at)}
            {m.disabled_at ? ' · მოხსნილი' : ''}
          </p>
        </div>
        {m.role === 'owner' && <span className="text-sm font-semibold">{ROLE.owner}</span>}
      </div>
      {m.role !== 'owner' && (
        <form
          action={setMember.bind(null, company, m.user_id)}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <select
            name="role"
            defaultValue={m.role ?? 'member'}
            className="rounded-control border border-rule-strong bg-paper-sunk px-2 py-1"
          >
            <option value="admin">{ROLE.admin}</option>
            <option value="member">{ROLE.member}</option>
            <option value="viewer">{ROLE.viewer}</option>
          </select>
          {Object.entries(MODULE_LABEL).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="modules"
                value={k}
                defaultChecked={(m.modules ?? []).includes(k)}
              />{' '}
              {v}
            </label>
          ))}
          {m.role === 'member' && (
            <label className="flex items-center gap-1 font-medium">
              <input type="checkbox" name="can_open" value="1" defaultChecked={!!m.can_open} /> ➕
              გახსნის უფლება
            </label>
          )}
          <label className="flex items-center gap-1 text-mismatch">
            <input type="checkbox" name="disabled" value="1" defaultChecked={!!m.disabled_at} />{' '}
            მოხსნა
          </label>
          <button type="submit" className="rounded-control border border-rule-strong px-3 py-1">
            შენახვა
          </button>
        </form>
      )}
    </li>
  );
}

/** One client company: its managers and counters, their modules, and invites. */
export default async function PlatformCompany({
  params,
  searchParams,
}: PageProps<'/manage/platform/[company]'>) {
  const { company } = await params;
  const created = (await searchParams).created === '1';
  await requireSession();
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_platform_admin');
  if (!admin) redirect('/manage');
  const [{ data: companies }, { data: members }, { data: invites }, { data: flags }] =
    await Promise.all([
      supabase.rpc('platform_companies'),
      supabase.rpc('platform_members'),
      supabase.rpc('platform_invites'),
      supabase.rpc('platform_can_open'),
    ]);
  const canOpen = new Set(
    ((flags ?? []) as { user_id: string; can_open: boolean }[])
      .filter((f) => f.can_open)
      .map((f) => f.user_id),
  );
  const co = ((companies ?? []) as { id: string; name: string }[]).find((c) => c.id === company);
  if (!co) notFound();
  const people = ((members ?? []) as Member[])
    .filter((m) => m.company_id === company)
    .map((m) => ({ ...m, can_open: canOpen.has(m.user_id) }));
  const pending = ((invites ?? []) as Invite[]).filter((i) => i.company_id === company);
  const managers = people.filter((p) => p.role === 'owner' || p.role === 'admin');
  const counters = people.filter((p) => p.role === 'member' || p.role === 'viewer');
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <section className="grid content-start gap-4">
        <div>
          <Link
            href="/manage/platform"
            className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
          >
            ← დაბრუნება
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{co.name}</h1>
          {created && (
            <p className="mt-1 text-sm text-match">
              ✓ კომპანია შეიქმნა. მენეჯერს გაუგზავნე ლინკი: {appUrl}/login — დარეგისტრირდეს მოწვეული
              მეილით.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <h2 className="font-semibold">👔 მენეჯერები ({managers.length})</h2>
          {managers.length ? (
            <ul className="grid gap-2">
              {managers.map((m) => (
                <Person key={m.user_id} m={m} company={company} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">
              ჯერ არავინ — მოწვეული მენეჯერი რეგისტრაციის შემდეგ გამოჩნდება.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <h2 className="font-semibold">👷 აღწერის თანამშრომლები ({counters.length})</h2>
          {counters.length ? (
            <ul className="grid gap-2">
              {counters.map((m) => (
                <Person key={m.user_id} m={m} company={company} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">ჯერ არავინ.</p>
          )}
          <p className="text-xs text-ink-faint">
            მონიშნული მოდულები = რისი დათვლა შეუძლია. მენეჯერს ყველაფერი შეუძლია.
          </p>
        </div>
        {pending.length > 0 && (
          <div className="grid gap-1 text-sm">
            <h2 className="font-semibold">✉ მოლოდინში (ჯერ არ დარეგისტრირებულა)</h2>
            {pending.map((i) => (
              <p key={i.id} className="text-ink-soft">
                {i.email} · {ROLE[i.role]}
                {i.role === 'member'
                  ? ` · ${i.modules.map((m) => MODULE_LABEL[m]).join(', ')}`
                  : ''}
              </p>
            ))}
          </div>
        )}
      </section>
      <InviteForm companyId={company} companyName={co.name} appUrl={appUrl} />
    </div>
  );
}
