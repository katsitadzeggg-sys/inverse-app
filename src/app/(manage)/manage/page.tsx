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

  // Counting activity: lines per day over the last 7 days (Tbilisi days).
  const DAY = ['კვ', 'ორ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'];
  const tbDay = (t: number) => new Date(t + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = weekAgo.getTime() + (i + 1) * 86400000;
    return { key: tbDay(t), label: DAY[new Date(t + 4 * 3600 * 1000).getUTCDay()], n: 0 };
  });
  for (const e of recentEntries ?? []) {
    const d = days.find((x) => x.key === tbDay(new Date(e.created_at).getTime()));
    if (d) d.n += 1;
  }
  const peak = Math.max(1, ...days.map((d) => d.n));
  // Progress of the open stocktakes: closed shelves of all shelves started.
  const shelvesAll = [...progress.values()].reduce((a, p) => a + p.all, 0);
  const shelvesDone = [...progress.values()].reduce((a, p) => a + p.done, 0);
  const pct = shelvesAll ? Math.round((shelvesDone / shelvesAll) * 100) : 0;
  const last = recent[0];
  const initials = (n: string) =>
    n
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  const AV = ['#fde2e1', '#dcefe4', '#e3e8fd', '#fdf0d5', '#efe2fd'];

  // Semicircle gauge: the done part as an arc of a 180° track.
  const R = 80;
  const arc = (from: number, to: number) => {
    const p = (f: number) => {
      const a = Math.PI * (1 - f);
      return `${100 + R * Math.cos(a)} ${100 - R * Math.sin(a)}`;
    };
    return `M ${p(from)} A ${R} ${R} 0 0 1 ${p(to)}`;
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-paper-sunk px-5 py-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">დეშბორდი</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {company.name} · {open.length} მიმდინარე ინვენტარიზაცია · სულ {all.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/manage/new"
            className="rounded-full bg-[#1f7a4d] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#155c39]"
          >
            + ახალი ინვენტარიზაცია
          </Link>
          <Link
            href="/manage/sites"
            className="rounded-full border border-[#1f7a4d] px-5 py-2.5 text-sm font-semibold text-[#155c39] hover:bg-[#eef7f1]"
          >
            ობიექტები
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          featured
          href="/manage/stocktakes"
          label="მიმდინარე"
          value={open.length}
          hint="ღია ინვენტარიზაცია"
        />
        <Stat
          label="დღეს დაითვალა"
          value={doneToday}
          hint={`თარო · ახლა ითვლება: ${countingNow}`}
        />
        <Stat
          label="ღია სხვაობა"
          value={diffs}
          tone={diffs ? 'mismatch' : 'default'}
          hint="გადასათვლელი და გაყინული"
        />
        <Stat
          href="/manage/team"
          label="გუნდი"
          value={(team ?? []).length}
          hint={`აღწერის თანამშრომელი: ${counters}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        {/* Activity */}
        <Card title="დათვლის აქტივობა · 7 დღე" className="xl:col-span-2">
          <div className="flex h-44 items-end justify-between gap-3 px-1">
            {days.map((d, i) => {
              const h = Math.max(18, Math.round((d.n / peak) * 100));
              const today = i === 6;
              return (
                <div key={d.key} className="flex flex-1 flex-col items-center gap-2">
                  <div className="relative flex h-36 w-full max-w-14 items-end">
                    {d.n > 0 && (
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-rule bg-paper-sunk px-1.5 text-[10px] tabular-nums text-ink-soft">
                        {d.n}
                      </span>
                    )}
                    <div
                      className={`w-full rounded-full ${
                        d.n === 0
                          ? 'bar-hatch'
                          : today
                            ? 'bg-[#155c39]'
                            : d.n === peak
                              ? 'bg-[#1f7a4d]'
                              : 'bg-[#5fbf8a]'
                      }`}
                      style={{ height: `${h}%` }}
                      title={`${d.key}: ${d.n} ხაზი`}
                    />
                  </div>
                  <span
                    className={`text-xs ${today ? 'font-semibold text-ink' : 'text-ink-faint'}`}
                  >
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Last closed shelf */}
        <Card title="ბოლოს დაითვალა">
          {last ? (
            <div className="grid gap-3">
              <p className="text-2xl font-semibold leading-tight text-[#155c39]">
                თარო {last.locations?.code}
              </p>
              <p className="text-sm text-ink-soft">
                {name.get(last.stocktake_id)?.number} ·{' '}
                {name.get(last.stocktake_id)?.branch ?? name.get(last.stocktake_id)?.client_name}
                <span className="block text-xs text-ink-faint">
                  {last.user_profiles?.full_name ?? last.user_profiles?.email} ·{' '}
                  {time(last.done_at!)}
                </span>
              </p>
              <Link
                href={`/manage/${last.stocktake_id}`}
                className="rounded-full bg-[#155c39] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#0f4a2d]"
              >
                ინვენტარიზაციის ნახვა
              </Link>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">ჯერ არცერთი თარო.</p>
          )}
        </Card>

        {/* Current stocktakes */}
        <Card
          title="მიმდინარე"
          className="xl:row-span-2"
          action={
            <Link
              href="/manage/new"
              className="rounded-full border border-ink/70 px-3 py-1 text-xs font-medium hover:bg-ink/5"
            >
              + ახალი
            </Link>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-ink-faint">ღია ინვენტარიზაცია არ არის.</p>
          ) : (
            <ul className="grid gap-3">
              {open.slice(0, 8).map((st, i) => {
                const p = progress.get(st.id) ?? { all: 0, done: 0, counting: 0 };
                const d = diffBy.get(st.id) ?? 0;
                return (
                  <li key={st.id}>
                    <Link
                      href={`/manage/${st.id}`}
                      className="flex gap-3 rounded-xl p-1 hover:bg-paper"
                    >
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold text-[#155c39]"
                        style={{ background: AV[i % AV.length] }}
                      >
                        {KIND[st.kind]?.slice(0, 2)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {st.branch ?? st.client_name ?? st.name}
                        </span>
                        <span className="block text-xs text-ink-faint">
                          {st.number} · {p.done}/{p.all} თარო
                          {d > 0 && <span className="text-mismatch"> · ⚠ {d}</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Team speed */}
        <Card title="გუნდი · სისწრაფე">
          {speed.length === 0 ? (
            <p className="text-sm text-ink-faint">ბოლო 7 დღეში დათვლა არ ყოფილა.</p>
          ) : (
            <ul className="grid gap-3">
              {speed.slice(0, 5).map((v, i) => (
                <li key={v.name} className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink"
                    style={{ background: AV[i % AV.length] }}
                  >
                    {initials(v.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <span className="block text-xs text-ink-faint">{v.lines} ხაზი · 7 დღე</span>
                  </span>
                  <span className="rounded-md border border-[#bfe3cd] bg-[#eef7f1] px-2 py-0.5 text-xs font-medium tabular-nums text-[#155c39]">
                    {v.perHour}/სთ
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Progress gauge */}
        <Card title="პროგრესი">
          <div className="grid justify-items-center">
            <svg viewBox="0 0 200 112" className="w-full max-w-60" aria-hidden>
              <path
                d={arc(0, 1)}
                fill="none"
                stroke="#e4e9e6"
                strokeWidth="26"
                strokeLinecap="round"
              />
              {pct > 0 && (
                <path
                  d={arc(0, Math.min(pct, 99.9) / 100)}
                  fill="none"
                  stroke="#1f7a4d"
                  strokeWidth="26"
                  strokeLinecap="round"
                />
              )}
            </svg>
            <p className="-mt-12 text-4xl font-semibold tabular-nums">{pct}%</p>
            <p className="text-xs text-ink-faint">
              {shelvesDone} / {shelvesAll} თარო დახურულია
            </p>
          </div>
        </Card>

        {/* Money */}
        <section className="rounded-2xl bg-gradient-to-br from-[#0f3d26] via-[#155c39] to-[#0b2e1d] p-5 text-white">
          <p className="text-base font-semibold">სხვაობა თანხით</p>
          <p className="mt-3 text-4xl font-semibold tabular-nums">
            {gel(money.plus - money.minus)}
          </p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm text-white/85">
            <dt>მეტობა</dt>
            <dd className="text-right tabular-nums">{gel(money.plus)}</dd>
            <dt>დანაკლისი</dt>
            <dd className="text-right tabular-nums">−{gel(money.minus)}</dd>
          </dl>
          {worst.length > 0 && (
            <ul className="mt-3 grid gap-1 border-t border-white/15 pt-2 text-xs">
              {worst.slice(0, 3).map((r) => {
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
                      <span className="tabular-nums">−{gel(Number(r.minus_sum))}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`ტოპ დანაკლისი${latest ? ` · ${latest.number}` : ''}`}>
          {top.length === 0 ? (
            <p className="text-sm text-ink-faint">დანაკლისი არ არის.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {top.map((l) => (
                <li key={l.n} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span className="truncate" title={l.name}>
                    {l.name}
                  </span>
                  <span className="tabular-nums text-mismatch">{l.diff}</span>
                  <span className="w-20 text-right tabular-nums text-ink-soft">
                    {l.loss ? gel(l.loss) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="ბოლოს დათვლილი თაროები">
          {recent.length === 0 ? (
            <p className="text-sm text-ink-faint">ჯერ არცერთი.</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">
                    <b>{r.locations?.code}</b> ·{' '}
                    {r.user_profiles?.full_name ?? r.user_profiles?.email}
                    <span className="block truncate text-xs text-ink-faint">
                      {name.get(r.stocktake_id)?.number} ·{' '}
                      {name.get(r.stocktake_id)?.branch ?? name.get(r.stocktake_id)?.client_name}
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
  );
}
