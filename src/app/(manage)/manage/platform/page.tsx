import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, Stat } from '@/components/ui';
import CreateCompanyForm from './create-company-form';

export const metadata = { title: 'პლატფორმა' };

type Client = {
  company_id: string;
  name: string;
  plan: string;
  created_at: string;
  people: number;
  counters: number;
  stocktakes: number;
  open_stocktakes: number;
  stock_count: number;
  expiry_count: number;
  assets_count: number;
  shelves_done: number;
  lines: number;
  assets_checked: number;
  media: number;
  last_activity: string | null;
  active_30d: boolean;
};
type Month = {
  month: string;
  new_companies: number;
  stocktakes: number;
  shelves_done: number;
  active_companies: number;
};

const n = (v: number | string) => Number(v).toLocaleString('ka-GE');
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('ka-GE') : '—');
const MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];

/**
 * Inverse platform console: analytics of the client companies renting the
 * app — who is active, how much they count, which modules they use, the trend
 * by month — and the place to register a new client. Platform admins only.
 */
export default async function PlatformPage() {
  await requireSession();
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_platform_admin');
  if (!admin) redirect('/manage');
  const [{ data: a }, { data: m }, { data: members }] = await Promise.all([
    supabase.rpc('platform_analytics'),
    supabase.rpc('platform_monthly'),
    supabase.rpc('platform_members'),
  ]);
  const clients = (a ?? []) as Client[];
  const months = (m ?? []) as Month[];
  const orphans = (
    (members ?? []) as { company_id: string | null; email: string; registered_at: string }[]
  ).filter((x) => !x.company_id);

  const sum = (k: keyof Client) => clients.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  const active = clients.filter((c) => c.active_30d).length;
  const modules = [
    { label: '📦 მარაგები', value: sum('stock_count'), color: 'bg-ink' },
    { label: '⏳ ვადიანი', value: sum('expiry_count'), color: 'bg-review' },
    { label: '🏷 ძირ. საშუალებები', value: sum('assets_count'), color: 'bg-match' },
  ];
  const modTotal = Math.max(
    1,
    modules.reduce((s, x) => s + x.value, 0),
  );
  const peak = Math.max(
    1,
    ...months.map((x) => Math.max(Number(x.stocktakes), Number(x.shelves_done))),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">🏢 პლატფორმა — კლიენტები</h1>
        <p className="mt-1 text-sm text-ink-faint">
          ყველა კომპანია, ვინც Inverse-ს იყენებს: აქტივობა, მოდულები, ტრენდი.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="კლიენტი"
          value={clients.length}
          hint={`აქტიური 30 დღეში: ${active}`}
          tone={active ? 'match' : 'default'}
        />
        <Stat
          label="მომხმარებელი"
          value={n(sum('people'))}
          hint={`აღმწერი: ${n(sum('counters'))}`}
        />
        <Stat
          label="ინვენტარიზაცია"
          value={n(sum('stocktakes'))}
          hint={`ახლა ღია: ${n(sum('open_stocktakes'))}`}
        />
        <Stat
          label="დათვლილი"
          value={n(sum('shelves_done'))}
          hint={`თარო/ოთახი · ${n(sum('lines'))} ხაზი · ${n(sum('assets_checked'))} ძ.ს. · ${n(sum('media'))} ფოტო`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="აქტივობა თვეების მიხედვით (12 თვე)">
          <div className="flex h-44 items-end gap-1.5">
            {months.map((x) => {
              const d = new Date(x.month);
              return (
                <div
                  key={x.month}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${MONTHS[d.getMonth()]}: ${x.stocktakes} ინვენტარიზაცია, ${x.shelves_done} თარო, ${x.active_companies} კლიენტი${Number(x.new_companies) ? `, ახალი კლიენტი: ${x.new_companies}` : ''}`}
                >
                  <div className="flex h-36 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-ink/80"
                      style={{ height: `${(Number(x.stocktakes) / peak) * 100}%` }}
                    />
                    <div
                      className="w-1/2 rounded-t bg-match/80"
                      style={{ height: `${(Number(x.shelves_done) / peak) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-ink-faint">{MONTHS[d.getMonth()]}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-ink-soft">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-ink/80" /> ინვენტარიზაცია
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-match/80" /> დათვლილი თარო / ოთახი
            </span>
          </div>
        </Card>

        <Card title="მოდულების გამოყენება">
          <div className="flex h-3 overflow-hidden rounded-full bg-paper-sunk">
            {modules.map((x) => (
              <div
                key={x.label}
                className={x.color}
                style={{ width: `${(x.value / modTotal) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-4 grid gap-2 text-sm">
            {modules.map((x) => (
              <li key={x.label} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${x.color}`} />
                  {x.label}
                </span>
                <span className="tabular-nums text-ink-soft">
                  {x.value} · {Math.round((x.value / modTotal) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title={`კლიენტები (${clients.length})`}>
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr className="border-b border-rule/70">
                  <th className="px-5 py-2">კომპანია</th>
                  <th className="px-2">ხალხი</th>
                  <th className="px-2">ინვენტ.</th>
                  <th className="px-2">მოდულები</th>
                  <th className="px-2 text-right">თარო</th>
                  <th className="px-2 text-right">ხაზი</th>
                  <th className="px-2 text-right">ძ.ს.</th>
                  <th className="px-2 text-right">📷</th>
                  <th className="px-5">ბოლო</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.company_id}
                    className="border-b border-rule/50 align-top hover:bg-paper-sunk/40"
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/manage/platform/${c.company_id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <span className="block text-xs text-ink-faint">
                        {c.plan} · {day(c.created_at)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">
                      {c.people}
                      <span className="block text-xs text-ink-faint">აღმ. {c.counters}</span>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">
                      {c.stocktakes}
                      {Number(c.open_stocktakes) > 0 && (
                        <span className="block text-xs text-review">ღია {c.open_stocktakes}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-xs">
                      {[
                        Number(c.stock_count) && '📦',
                        Number(c.expiry_count) && '⏳',
                        Number(c.assets_count) && '🏷',
                      ]
                        .filter(Boolean)
                        .join(' ') || '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{n(c.shelves_done)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{n(c.lines)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{n(c.assets_checked)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{n(c.media)}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <span
                        className={`mr-1 inline-block h-2 w-2 rounded-full ${c.active_30d ? 'bg-match' : 'bg-rule-strong'}`}
                      />
                      {day(c.last_activity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <CreateCompanyForm />
          {orphans.length > 0 && (
            <Card title={`კომპანიის გარეშე (${orphans.length})`}>
              <ul className="grid gap-1 text-sm">
                {orphans.map((o) => (
                  <li key={o.email} className="text-ink-soft">
                    {o.email}{' '}
                    <span className="text-xs text-ink-faint">· {day(o.registered_at)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-faint">
                დაარეგისტრირა, მაგრამ კომპანიაში არ შესულა. მოიწვიე კომპანიის გვერდიდან იმავე
                მეილით.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
