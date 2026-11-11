import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, Stat } from '@/components/ui';
import type { Stocktake } from '@/types/database';
import { stockActData } from '@/lib/stock-act';

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
    timeZone: 'Asia/Tbilisi',
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

  // ---- Analytics (stock) ----
  // Money: surplus / shortage over the stock stocktakes in the list.
  const stockIds = all.filter((s) => s.kind !== 'assets').map((s) => s.id);
  const { data: statRows } = stockIds.length
    ? await supabase.rpc('stocktake_stats4', { p_ids: stockIds })
    : { data: [] };
  type St = {
    stocktake_id: string;
    plus_sum: number;
    minus_sum: number;
    plus_qty: number;
    minus_qty: number;
  };
  const money = { plus: 0, minus: 0 };
  for (const r of (statRows ?? []) as St[]) {
    money.plus += Number(r.plus_sum);
    money.minus += Number(r.minus_sum);
  }
  const worst = ((statRows ?? []) as St[])
    .filter((r) => Number(r.minus_sum) > 0)
    .sort((a, b) => Number(b.minus_sum) - Number(a.minus_sum))
    .slice(0, 5);
  // Biggest shortages (by money) in the latest stock stocktake.
  const latest = all.find((s) => s.kind !== 'assets');
  const top = latest
    ? (await stockActData(supabase, latest.id)).lines
        .filter((l) => l.diff < 0)
        .map((l) => ({ ...l, loss: -l.diff * (l.cost ?? 0) }))
        .sort((a, b) => b.loss - a.loss || a.diff - b.diff)
        .slice(0, 8)
    : [];
  // Speed: lines per hour per counting employee over the last 7 days
  // (time between the first and last line of each day).
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const since = weekAgo.toISOString();
  const { data: recentEntries } = await supabase
    .from('stocktake_entries')
    .select('counter_id, created_at')
    .gte('created_at', since)
    .limit(20000)
    .returns<
      {
        counter_id: string | null;
        created_at: string;
      }[]
    >();
  const { data: profs } = await supabase
    .from('user_profiles')
    .select('id, full_name, email')
    .returns<{ id: string; full_name: string | null; email: string }[]>();
  const people = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const speedMap = new Map<
    string,
    { name: string; lines: number; days: Map<string, [number, number]> }
  >();
  for (const e of recentEntries ?? []) {
    if (!e.counter_id) continue;
    const t = new Date(e.created_at).getTime();
    const day = new Date(t + 4 * 3600 * 1000).toISOString().slice(0, 10); // Tbilisi day
    const v = speedMap.get(e.counter_id) ?? {
      name: people.get(e.counter_id) ?? '—',
      lines: 0,
      days: new Map(),
    };
    v.lines += 1;
    const d = v.days.get(day);
    v.days.set(day, d ? [Math.min(d[0], t), Math.max(d[1], t)] : [t, t]);
    speedMap.set(e.counter_id, v);
  }
  const speed = [...speedMap.values()]
    .map((v) => {
      const hours = [...v.days.values()].reduce(
        (h, [a, b]) => h + Math.max(0.25, (b - a) / 3.6e6),
        0,
      );
      return { name: v.name, lines: v.lines, perHour: Math.round(v.lines / hours) };
    })
    .sort((a, b) => b.perHour - a.perHour);
  const gel = (v: number) => `${Math.round(v).toLocaleString('ka-GE')} ₾`;

  return (
    <div className="dash-glass space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {open.length} მიმდინარე ინვენტარიზაცია · სულ {all.length}
          </p>
        </div>
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
        <Stat
          label="გუნდი"
          value={(team ?? []).length}
          hint={`აღწერის თანამშრომელი: ${counters}`}
        />
      </div>

      {/* Analytics: money, biggest shortages, counting speed. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="💰 სხვაობა თანხით">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-ink-soft">მეტობა</dt>
            <dd className="text-right font-semibold text-[#60a5fa] tabular-nums">
              {gel(money.plus)}
            </dd>
            <dt className="text-ink-soft">დანაკლისი</dt>
            <dd className="text-right font-semibold text-[#f87171] tabular-nums">
              {gel(money.minus)}
            </dd>
            <dt className="text-ink-soft">სხვაობა</dt>
            <dd className="text-right font-bold tabular-nums">{gel(money.plus - money.minus)}</dd>
          </dl>
          {worst.length > 0 && (
            <ul className="mt-3 grid gap-1 border-t border-rule/60 pt-2 text-xs">
              {worst.map((r) => {
                const st = name.get(r.stocktake_id);
                return (
                  <li key={r.stocktake_id}>
                    <Link
                      href={`/manage/${r.stocktake_id}`}
                      className="flex justify-between gap-2 hover:underline"
                    >
                      <span className="truncate">
                        {st?.number} · {st?.branch ?? st?.client_name}
                      </span>
                      <span className="text-[#f87171] tabular-nums">
                        −{gel(Number(r.minus_sum))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-faint">
            ღია ინვენტარიზაციებში — მხოლოდ დახურული თაროებით.
          </p>
        </Card>

        <Card title={`📉 ტოპ დანაკლისი${latest ? ` · ${latest.number}` : ''}`}>
          {top.length === 0 ? (
            <p className="text-sm text-ink-faint">დანაკლისი არ არის.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {top.map((l) => (
                <li key={l.n} className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <span className="truncate" title={l.name}>
                    {l.name}
                  </span>
                  <span className="text-[#f87171] tabular-nums">{l.diff}</span>
                  <span className="w-20 text-right tabular-nums text-ink-soft">
                    {l.loss ? gel(l.loss) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="⚡ დათვლის სისწრაფე · 7 დღე">
          {speed.length === 0 ? (
            <p className="text-sm text-ink-faint">ბოლო 7 დღეში დათვლა არ ყოფილა.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {speed.map((v) => (
                <li key={v.name} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span className="truncate">{v.name}</span>
                  <span className="tabular-nums text-ink-soft">{v.lines} ხაზი</span>
                  <span className="w-20 text-right font-semibold tabular-nums">{v.perHour}/სთ</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-faint">
            ხაზი საათში — დღის პირველიდან ბოლო ჩანაწერამდე.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="მიმდინარე ინვენტარიზაციები"
          action={
            <Link href="/manage/stocktakes" className="text-xs text-ink">
              ყველა
            </Link>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-ink-faint">ღია ინვენტარიზაცია არ არის.</p>
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
