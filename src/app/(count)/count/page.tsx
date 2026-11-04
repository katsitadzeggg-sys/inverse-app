import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';

export default async function CountHome() {
  const { profile } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';
  const supabase = await createClient();
  const { data } = await supabase
    .from('stocktakes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
    .returns<Stocktake[]>();
  const open = (data ?? []).filter((s) => s.status === 'open');

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">ინვენტარიზაციები</h1>

      {open.length === 0 ? (
        <p className="text-ink-soft">
          ღია ინვენტარიზაცია არ არის.{manager ? ' გახსენი მართვის პანელიდან.' : ' მიმართე მენეჯერს.'}
        </p>
      ) : (
        <ul className="grid gap-3">
          {open.map((s) => (
            <li key={s.id}>
              <Link
                href={`/count/${s.id}`}
                className="block rounded-control border border-rule-strong bg-paper-sunk px-4 py-4 text-lg font-semibold"
              >
                <span className="block text-sm font-normal text-ink-faint">{s.number} · {new Date(s.count_date).toLocaleDateString('ka-GE')}{s.kind === 'expiry' ? ' · ⏳ ვადიანი' : s.kind === 'assets' ? ' · 🏷 ძირ. საშუალებები' : ''}</span>
                {s.client_name ?? s.name}
                {s.branch && <span className="block text-base font-normal text-ink-soft">{s.branch}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {manager && (
        <Link href="/manage" className="rounded-control border border-rule-strong px-4 py-3 text-center text-sm">⚙ მართვის პანელი — ახალი ინვენტარიზაცია, ნაშთი, ანგარიშები</Link>
      )}

    </div>
  );
}
