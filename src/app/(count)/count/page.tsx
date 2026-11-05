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

  const multi = new Set(open.map((s) => s.kind)).size > 1;
  const ICON: Record<string, string> = { stock: '📦', expiry: '⏳', assets: '🏷' };

  return (
    <div className="grid gap-5">
      {profile.can_open && (
        <details className="group rounded-control border-2 border-ink bg-ink text-paper open:bg-paper open:text-ink">
          <summary className="cursor-pointer list-none px-4 py-5 text-center text-xl font-semibold [&::-webkit-details-marker]:hidden">
            ＋ ახალი ინვენტარიზაცია
          </summary>
          <div className="border-t border-rule/70 p-3">
            <NewStocktakeForm kind={profile.modules?.[0]} kinds={profile.modules} companyName={company.name} sites={sites ?? []} allowNewSite={false} fixed />
          </div>
        </details>
      )}

      {open.length === 0 ? (
        <p className="text-center text-sm text-ink-soft">
          ღია ინვენტარიზაცია არ არის.{profile.can_open ? '' : ' მიმართე მენეჯერს.'}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {open.map((s) => (
            <li key={s.id}>
              <Link
                href={`/count/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-control border border-rule/70 bg-paper-sunk px-3 py-2.5"
              >
                <span className="min-w-0 truncate font-semibold">
                  {multi && <span className="mr-1">{ICON[s.kind]}</span>}
                  {s.branch ?? s.client_name ?? s.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {s.number.replace(/^INV-\d{4}-/, '№')} · {new Date(s.count_date).toLocaleDateString('ka-GE')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
