import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import CreateCompanyForm from './create-company-form';

export const metadata = { title: 'პლატფორმა' };

type Company = {
  id: string; name: string; plan: string; created_at: string;
  managers: number; counters: number; open_invites: number; stocktakes: number; last_activity: string | null;
};

/**
 * Inverse platform console: the client companies renting the app, how many
 * managers and counters each has, open invites and activity. Open a company
 * to manage its people and their modules. Platform admins only.
 */
export default async function PlatformPage() {
  await requireSession();
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_platform_admin');
  if (!admin) redirect('/manage');
  const [{ data: companies }, { data: members }] = await Promise.all([
    supabase.rpc('platform_companies'),
    supabase.rpc('platform_members'),
  ]);
  const list = (companies ?? []) as Company[];
  const orphans = ((members ?? []) as { company_id: string | null; email: string; registered_at: string }[]).filter((m) => !m.company_id);
  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('ka-GE') : '—');

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <section className="grid content-start gap-3">
        <h1 className="text-xl font-semibold">🏢 პლატფორმა — კომპანიები</h1>
        <p className="text-sm text-ink-soft">კომპანია: {list.length} · მენეჯერი: {list.reduce((s, c) => s + Number(c.managers), 0)} · აღმწერი: {list.reduce((s, c) => s + Number(c.counters), 0)}</p>
        <ul className="grid gap-2">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/manage/platform/${c.id}`} className="grid gap-1 rounded-control border border-rule-strong px-4 py-3 hover:bg-paper-sunk">
                <span className="flex justify-between gap-2">
                  <span className="text-lg font-semibold">{c.name}</span>
                  <span className="text-sm text-ink-faint">{c.plan}</span>
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                  <span>👔 მენეჯერი: {c.managers}</span>
                  <span>👷 აღმწერი: {c.counters}</span>
                  {Number(c.open_invites) > 0 && <span className="text-review">✉ მოლოდინში: {c.open_invites}</span>}
                  <span>📋 ინვენტარიზაცია: {c.stocktakes}</span>
                  <span className="text-ink-faint">ბოლო: {day(c.last_activity)} · შექმნა: {day(c.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {orphans.length > 0 && (
          <div className="grid gap-1 text-sm">
            <h2 className="font-semibold text-ink-soft">დარეგისტრირდა, კომპანიაში არ არის: {orphans.length}</h2>
            {orphans.map((o) => <p key={o.email} className="text-ink-faint">{o.email} · {day(o.registered_at)}</p>)}
            <p className="text-xs text-ink-faint">რომელიმე კომპანიაში რომ შევიდეს, კომპანიის გვერდზე მოიწვიე იმავე მეილით და თავიდან შევიდეს.</p>
          </div>
        )}
      </section>
      <CreateCompanyForm />
    </div>
  );
}
