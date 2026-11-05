import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { setAccess } from './actions';

export const metadata = { title: 'რეგისტრაციები' };

type Row = {
  user_id: string; email: string; full_name: string | null; company_id: string | null; company_name: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer' | null; disabled_at: string | null; registered_at: string;
  confirmed: boolean; last_sign_in_at: string | null;
};

const ROLE: Record<string, string> = { owner: 'მფლობელი', admin: 'მენეჯერი', member: 'აღმწერი', viewer: 'მნახველი' };
const when = (d: string | null) => (d ? new Date(d).toLocaleString('ka-GE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Inverse platform view: everyone who registered, grouped by company, with
 * their role and status. Roles and access are changed here. Only for
 * platform admins (info@inverse.ge).
 */
export default async function UsersPage() {
  await requireSession();
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_platform_admin');
  if (!admin) redirect('/manage');
  const { data } = await supabase.rpc('platform_users');
  const rows = (data ?? []) as Row[];

  const groups = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    const key = r.company_id ?? 'none';
    const g = groups.get(key) ?? { name: r.company_name ?? 'კომპანიის გარეშე (რეგისტრაცია არ დაუსრულებია)', rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const active = rows.filter((r) => r.company_id && !r.disabled_at).length;

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/manage" className="text-sm text-ink-faint">← ინვენტარიზაციები</Link>
        <h1 className="mt-1 text-xl font-semibold">რეგისტრაციები</h1>
        <p className="text-sm text-ink-soft">
          სულ {rows.length} ანგარიში, {groups.size} ჯგუფი, აქტიური {active}. როლის შესაცვლელად აირჩიე და დააჭირე „შენახვა“.
        </p>
      </div>

      {[...groups.entries()].map(([key, g]) => (
        <section key={key} className="grid gap-2">
          <h2 className="font-semibold">{g.name} <span className="font-normal text-ink-faint">· {g.rows.length}</span></h2>
          <div className="overflow-x-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left text-xs text-ink-faint">
                <tr>
                  <th className="p-2">სახელი / მეილი</th><th className="p-2">რეგისტრაცია</th><th className="p-2">ბოლო შესვლა</th>
                  <th className="p-2">სტატუსი</th><th className="p-2">როლი</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.user_id} className={`border-t border-rule/60 align-top ${r.disabled_at ? 'opacity-60' : ''}`}>
                    <td className="p-2">
                      <p className="font-medium">{r.full_name ?? '—'}</p>
                      <p className="text-xs text-ink-faint">{r.email}</p>
                    </td>
                    <td className="p-2 tabular-nums">{when(r.registered_at)}</td>
                    <td className="p-2 tabular-nums">{when(r.last_sign_in_at)}</td>
                    <td className="p-2">
                      {r.disabled_at ? <span className="text-mismatch">მოხსნილი</span> : !r.confirmed ? <span className="text-review">მეილი დაუდასტურებელი</span> : <span className="text-match">აქტიური</span>}
                    </td>
                    <td className="p-2">
                      {!r.company_id ? (
                        <span className="text-ink-faint">—</span>
                      ) : r.role === 'owner' ? (
                        <span className="font-semibold">{ROLE.owner}</span>
                      ) : (
                        <form action={setAccess.bind(null, r.user_id)} className="flex flex-wrap items-center gap-2">
                          <select name="role" defaultValue={r.role ?? 'member'} className="rounded-control border border-rule-strong bg-paper-sunk px-2 py-1">
                            <option value="admin">{ROLE.admin}</option>
                            <option value="member">{ROLE.member}</option>
                            <option value="viewer">{ROLE.viewer}</option>
                          </select>
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" name="disabled" value="1" defaultChecked={!!r.disabled_at} /> მოხსნა
                          </label>
                          <button type="submit" className="rounded-control border border-rule-strong px-2 py-1 text-xs">შენახვა</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="text-xs text-ink-faint">
        მფლობელი — ყველაფერი, მათ შორის გუნდი. მენეჯერი — ინვენტარიზაციები, ნაშთი, შედეგები, მოწვევა. აღმწერი — მხოლოდ დათვლა. მნახველი — მხოლოდ ნახვა.
      </p>
    </div>
  );
}
