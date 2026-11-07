import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { ButtonLink, Card, Stat } from '@/components/ui';
import type { Stocktake } from '@/types/database';

export const metadata = { title: 'მთავარი' };

const KIND: Record<string, string> = {
  stock: '📦 მარაგები',
  expiry: '⏳ ვადიანი',
  assets: '🏷 ძირ. საშუალებები',
};
const time = (v: string) =>
  new Date(v).toLocaleString('ka-GE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The manager's dashboard: open stocktakes and their progress, today's
 * counting, open differences and the team, with shortcuts to each module.
 */
export default async function ManageDashboard() {
  const { company } = await requireSession();
  const supabase = await createClient();

  const { data: stocktakes } = await supabase
    .from('stocktakes')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<Stocktake[]>();
  const all = stocktakes ?? [];
  const open = all.filter((s) => s.status === 'open');
  const openIds = open.map((s) => s.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ data: zones }, { data: checks }, { data: team }] = await Promise.all([
    openIds.length
      ? supabase
          .from('stocktake_zones')
          .select(
            'stocktake_id, status, done_at, started_at, locations (code), user_profiles (full_name, email)',
          )
          .in('stocktake_id', openIds)
          .order('started_at', { ascending: false })
          .limit(2000)
          .returns<
            {
              stocktake_id: string;
              status: string;
              done_at: string | null;
              started_at: string;
              locations: { code: string } | null;
              user_profiles: { full_name: string | null; email: string } | null;
            }[]
          >()
      : Promise.resolve({ data: [] }),
    openIds.length
      ? supabase
          .from('stocktake_checks')
          .select('stocktake_id')
          .in('stocktake_id', openIds)
          .neq('status', 'ok')
          .returns<{ stocktake_id: string }[]>()
      : Promise.resolve({ data: [] }),
    supabase
      .from('user_profiles')
      .select('id, role, disabled_at')
      .is('disabled_at', null)
      .returns<{ id: string; role: string }[]>(),
  ]);

  const z = zones ?? [];
  const progress = new Map<string, { all: number; done: number; counting: number }>();
  for (const row of z) {
    const p = progress.get(row.stocktake_id) ?? { all: 0, done: 0, counting: 0 };
    p.all += 1;
    if (row.status === 'done') p.done += 1;
    else p.counting += 1;
    progress.set(row.stocktake_id, p);
  }
  const diffBy = new Map<string, number>();
  for (const c of checks ?? []) diffBy.set(c.stocktake_id, (diffBy.get(c.stocktake_id) ?? 0) + 1);
  const doneToday = z.filter((r) => r.done_at && new Date(r.done_at) >= today).length;
  const countingNow = z.filter((r) => r.status !== 'done').length;
  const diffs = (checks ?? []).length;
  const counters = (team ?? []).filter((m) => m.role === 'member').length;
  const recent = z
    .filter((r) => r.status === 'done' && r.done_at)
    .sort((a, b) => b.done_at!.localeCompare(a.done_at!))
    .slice(0, 8);
  const byKind = (k: string) => all.filter((s) => s.kind === k);
  const name = new Map(all.map((s) => [s.id, s]));

  return (
    <div className="dash-glass space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {open.length} მიმდინარე ინვენტარიზაცია · სულ {all.length}
          </p>
        </div>
        <ButtonLink href="/manage/new">+ ახალი ინვენტარიზაცია</ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="მიმდინარე" value={open.length} hint="ღია ინვენტარიზაცია" />
        <Stat
          label="დღეს დაითვალა"
          value={doneToday}
          tone={doneToday ? 'match' : 'default'}
          hint={`ახლა ითვლება: ${countingNow}`}
        />
        <Stat
          label="ღია სხვაობა"
          value={diffs}
          tone={diffs ? 'mismatch' : 'match'}
          hint="გადასათვლელი და გაყინული"
        />
        <Stat label="გუნდი" value={(team ?? []).length} hint={`აღმწერი: ${counters}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="მიმდინარე ინვენტარიზაციები"
          action={
            <Link href="/manage/stocktakes?kind=stock" className="text-xs text-ink">
              ყველა
            </Link>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-ink-faint">
              ღია ინვენტარიზაცია არ არის. დაიწყე ზედა ღილაკით.
            </p>
          ) : (
            <ul className="divide-y divide-rule/70">
              {open.slice(0, 10).map((s) => {
                const p = progress.get(s.id) ?? { all: 0, done: 0, counting: 0 };
                const pct = p.all ? Math.round((p.done / p.all) * 100) : 0;
                const d = diffBy.get(s.id) ?? 0;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/manage/${s.id}`}
                      className="grid gap-1.5 py-3 hover:bg-paper-sunk/40"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {s.client_name ?? s.name}
                          {s.branch ? <span className="text-ink-faint"> · {s.branch}</span> : null}
                        </span>
                        <span className="text-xs text-ink-faint">
                          {KIND[s.kind]} · {s.number}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                          <div className="h-full bg-match" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-40 text-right text-xs tabular-nums text-ink-soft">
                          {p.done}/{p.all} თარო{p.counting ? ` · ${p.counting} ითვლება` : ''}
                        </span>
                      </div>
                      {d > 0 && (
                        <span className="text-xs font-semibold text-mismatch">⚠ სხვაობა: {d}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="მოდულები">
            <ul className="grid gap-2 text-sm">
              {(['stock', 'expiry', 'assets'] as const).map((k) => (
                <li key={k}>
                  <Link
                    href={`/manage/stocktakes?kind=${k}`}
                    className="flex items-center justify-between rounded-control px-2 py-2 hover:bg-paper-sunk"
                  >
                    <span>{KIND[k]}</span>
                    <span className="text-xs text-ink-faint tabular-nums">
                      {byKind(k).filter((s) => s.status === 'open').length} ღია · {byKind(k).length}{' '}
                      სულ
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="ბოლოს დათვლილი თაროები">
            {recent.length === 0 ? (
              <p className="text-sm text-ink-faint">ჯერ არცერთი.</p>
            ) : (
              <ul className="divide-y divide-rule/70 text-sm">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">
                      <b>{r.locations?.code}</b> ·{' '}
                      {r.user_profiles?.full_name ?? r.user_profiles?.email}
                      <span className="block truncate text-xs text-ink-faint">
                        {name.get(r.stocktake_id)?.client_name ?? name.get(r.stocktake_id)?.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                      {time(r.done_at!)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
