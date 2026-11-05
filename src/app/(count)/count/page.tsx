import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import NewStocktakeForm from '@/app/(manage)/manage/new-stocktake-form';

export default async function CountHome() {
  const { profile, userId, company } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';
  // Managers work in the manager module; the counting screen is for counters.
  if (manager) redirect('/manage');
  const allowedModules = new Set<string>(profile.modules ?? ['stock', 'expiry', 'assets']);
  const supabase = await createClient();
  const { data } = await supabase
    .from('stocktakes')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(30)
    .returns<Stocktake[]>();
  // A counter sees the stocktakes they are assigned to, plus those with nobody assigned.
  const { data: members } = await supabase.from('stocktake_members').select('stocktake_id, user_id').returns<{ stocktake_id: string; user_id: string }[]>();
  const assigned = new Map<string, Set<string>>();
  for (const m of members ?? []) assigned.set(m.stocktake_id, (assigned.get(m.stocktake_id) ?? new Set()).add(m.user_id));
  const { data: sites } = profile.can_open
    ? await supabase.from('sites').select('id, name, address, lat, lng').order('name')
        .returns<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null }[]>()
    : { data: [] };
  const open = (data ?? []).filter((s) => s.status === 'open' && allowedModules.has(s.kind) && (!assigned.has(s.id) || assigned.get(s.id)!.has(userId)));
  const MODULES = [
    { kind: 'stock', title: '📦 მარაგები', hint: 'სკანი → რაოდენობა', tone: 'border-l-ink' },
    { kind: 'expiry', title: '⏳ ვადიანი პროდუქცია', hint: 'სკანი → ვადა → რაოდენობა', tone: 'border-l-review' },
    { kind: 'assets', title: '🏷 ძირითადი საშუალებები', hint: 'ოთახი → ეტიკეტის სკანი → მდგომარეობა, ფოტო', tone: 'border-l-match' },
  ];

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">ინვენტარიზაციები</h1>

      {profile.can_open && (
        <details className="rounded-control border border-rule-strong">
          <summary className="cursor-pointer px-4 py-3 text-base font-semibold">+ ახალი ინვენტარიზაცია</summary>
          <div className="border-t border-rule/70 p-3">
            <NewStocktakeForm kind={profile.modules?.[0]} kinds={profile.modules} companyName={company.name} sites={sites ?? []} allowNewSite={false} />
          </div>
        </details>
      )}

      {open.length === 0 ? (
        <p className="text-ink-soft">
          ღია ინვენტარიზაცია არ არის.{manager ? ' გახსენი მართვის პანელიდან.' : ' მიმართე მენეჯერს.'}
        </p>
      ) : (
        <div className="grid gap-6">
          {MODULES.filter((m) => open.some((s) => s.kind === m.kind)).map((m) => (
            <section key={m.kind} className="grid gap-2">
              <div>
                <h2 className="text-lg font-semibold">{m.title}</h2>
                <p className="text-xs text-ink-faint">{m.hint}</p>
              </div>
              <ul className="grid gap-2">
                {open.filter((s) => s.kind === m.kind).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/count/${s.id}`}
                      className={`block rounded-control border border-l-4 border-rule-strong ${m.tone} bg-paper-sunk px-4 py-4 text-lg font-semibold`}
                    >
                      <span className="block text-sm font-normal text-ink-faint">{s.number} · {new Date(s.count_date).toLocaleDateString('ka-GE')}</span>
                      {s.client_name ?? s.name}
                      {s.branch && <span className="block text-base font-normal text-ink-soft">{s.branch}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {manager && (
        <Link href="/manage" className="rounded-control border border-rule-strong px-4 py-3 text-center text-sm">⚙ მართვის პანელი — ახალი ინვენტარიზაცია, ნაშთი, ანგარიშები</Link>
      )}

    </div>
  );
}
