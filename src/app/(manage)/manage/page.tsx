import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, Stat } from '@/components/ui';
import type { Stocktake } from '@/types/database';
import { stockActData } from '@/lib/stock-act';
import GlobalSearch from './global-search';
import { cycleName } from '@/lib/cycles';
import { aiCost } from '@/lib/ai-usage';
import { VISION_MODEL } from '@/lib/verification/analyze';

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

  const [{ data: zones }, { data: team }] = await Promise.all([
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
  const doneToday = z.filter((r) => r.done_at && new Date(r.done_at) >= today).length;
  const countingNow = z.filter((r) => r.status !== 'done').length;
  const counters = (team ?? []).filter((m) => m.role === 'member').length;
  const recent = z
    .filter((r) => r.status === 'done' && r.done_at)
    .sort((a, b) => b.done_at!.localeCompare(a.done_at!))
    .slice(0, 8);
  const name = new Map(all.map((s) => [s.id, s]));

  // ---- Analytics (stock) ----
  // Warehouses: the open cycle's stocktakes of one warehouse are one count,
  // compared with the whole balance — the same numbers as the pinned rows of
  // the stocktakes list.
  const stock = all.filter((s) => s.kind !== 'assets');
  const cycleIds = [...new Set(stock.map((s) => s.cycle_id).filter((x): x is string => !!x))];
  const { data: cycles } = cycleIds.length
    ? await supabase
        .from('count_cycles')
        .select('id, started_at, closed_at, name, code')
        .in('id', cycleIds)
    : { data: [] as never[] };
  const cycleOf = new Map((cycles ?? []).map((c) => [c.id as string, c]));
  const groups = new Map<string, { name: string; cycle?: string; ids: string[]; real: string[] }>();
  for (const s of stock) {
    const c = s.cycle_id ? cycleOf.get(s.cycle_id) : undefined;
    if (c?.closed_at) continue;
    const key = s.cycle_id ?? s.branch ?? s.client_name ?? s.name;
    const g = groups.get(key) ?? {
      name: s.branch || s.client_name || s.name,
      cycle: c ? cycleName(c, company.cycle_period) : undefined,
      ids: [] as string[],
      real: [] as string[],
    };
    g.ids.push(s.id);
    if (!s.form_kind) g.real.push(s.id);
    groups.set(key, g);
  }
  type Pool = {
    missed_skus: number;
    missed_sum: number;
    review_skus: number;
    plus_qty: number;
    plus_sum: number;
    minus_qty: number;
    minus_sum: number;
  };
  const { data: aiSum } = stock.length
    ? await supabase.rpc('stocktake_ai_summary', { p_ids: stock.map((s) => s.id) })
    : { data: [] };
  const aiBy = new Map(
    (
      (aiSum ?? []) as {
        stocktake_id: string;
        checked: number;
        matched: number;
        confidence: number;
      }[]
    ).map((a) => [a.stocktake_id, a]),
  );
  const pools = (
    await Promise.all(
      [...groups.values()].map(async (g) => {
        const [{ data: r }, { count: bookSkus }] = await Promise.all([
          supabase.rpc('stocktake_pool_stats', { p_ids: g.ids }),
          // Products in the balance: the newest real stocktake of the warehouse.
          supabase
            .from('stocktake_book')
            .select('product_id', { count: 'exact', head: true })
            .eq('stocktake_id', g.real[0] ?? g.ids[0])
            .gt('book_qty', 0),
        ]);
        const p = ((r ?? []) as Pool[])[0];
        const ai = g.ids.map((id) => aiBy.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
        const checked = ai.reduce((n, a) => n + Number(a.checked), 0);
        const matched = ai.reduce((n, a) => n + Number(a.matched), 0);
        const conf = checked
          ? ai.reduce((n, a) => n + Number(a.confidence) * Number(a.checked), 0) / checked
          : 0;
        const book = bookSkus ?? 0;
        const missed = Number(p?.missed_skus ?? 0);
        return {
          ...g,
          book,
          missed,
          missedSum: Number(p?.missed_sum ?? 0),
          review: Number(p?.review_skus ?? 0),
          plusQty: Number(p?.plus_qty ?? 0),
          plusSum: Number(p?.plus_sum ?? 0),
          minusQty: Number(p?.minus_qty ?? 0),
          minusSum: Number(p?.minus_sum ?? 0),
          pct: book ? Math.max(0, Math.round(((book - Math.min(missed, book)) / book) * 100)) : 0,
          ai: checked ? { checked, matched, pct: Math.round(conf * 100) } : null,
        };
      }),
    )
  ).sort((a, b) => a.name.localeCompare(b.name, 'ka'));
  const money = pools.reduce(
    (m, p) => ({ plus: m.plus + p.plusSum, minus: m.minus + p.minusSum }),
    { plus: 0, minus: 0 },
  );
  // Photo checks this month, and what they cost (vision model prices, USD per million tokens).
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: aiChecks } = await supabase
    .from('shelf_ai_checks')
    .select('input_tokens, output_tokens, result')
    .gte('created_at', monthStart.toISOString())
    .limit(5000)
    .returns<
      {
        input_tokens: number | null;
        output_tokens: number | null;
        result: { items?: { status: string }[] } | null;
      }[]
    >();
  const aiMonth = { checks: 0, usd: 0, other: 0, match: 0, unsure: 0, off: 0 };
  // The assistant and photo identification (table from migration 0067; empty before it).
  const { data: usageRows } = await supabase
    .from('ai_usage')
    .select('model, input_tokens, output_tokens')
    .gte('created_at', monthStart.toISOString())
    .limit(20000)
    .returns<{ model: string; input_tokens: number; output_tokens: number }[]>();
  for (const u of usageRows ?? [])
    aiMonth.other += aiCost(u.model, u.input_tokens, u.output_tokens);
  for (const c of aiChecks ?? []) {
    aiMonth.checks += 1;
    aiMonth.usd += aiCost(VISION_MODEL, c.input_tokens ?? 0, c.output_tokens ?? 0);
    for (const it of c.result?.items ?? []) {
      if (it.status === 'match') aiMonth.match += 1;
      else if (it.status === 'mismatch') aiMonth.off += 1;
      else aiMonth.unsure += 1;
    }
  }
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
  // Progress: products of the balance already counted, over the open warehouses.
  const bookAll = pools.reduce((a, p) => a + p.book, 0);
  const countedAll = pools.reduce((a, p) => a + Math.max(0, p.book - p.missed), 0);
  const pct = bookAll ? Math.round((countedAll / bookAll) * 100) : 0;
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
        <GlobalSearch />
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
          href="/manage/stocktakes?kind=stock"
          label="სხვაობა თანხით"
          value={gel(money.plus - money.minus)}
          tone={money.plus - money.minus < 0 ? 'mismatch' : 'default'}
          hint={`მეტობა ${gel(money.plus)} · დანაკლისი −${gel(money.minus)}`}
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
              {countedAll} / {bookAll} პროდუქტი დათვლილია
            </p>
          </div>
        </Card>

        {/* Photo check this month */}
        <Card title="AI ფოტო-შემოწმება · ეს თვე">
          {aiMonth.checks === 0 ? (
            <p className="text-sm text-ink-faint">ამ თვეში ფოტოებით შემოწმება არ ყოფილა.</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-3xl font-semibold tabular-nums">
                {aiMonth.checks}
                <span className="ml-1 text-sm font-normal text-ink-faint">თაროს შემოწმება</span>
              </p>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#e4e9e6]">
                {(
                  [
                    [aiMonth.match, 'bg-match'],
                    [aiMonth.unsure, 'bg-review'],
                    [aiMonth.off, 'bg-mismatch'],
                  ] as const
                ).map(([n, c]) => (
                  <span
                    key={c}
                    className={c}
                    style={{
                      width: `${(n / Math.max(1, aiMonth.match + aiMonth.unsure + aiMonth.off)) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-ink-soft">
                <span className="text-match">✓ {aiMonth.match}</span> ·{' '}
                <span className="text-review">? {aiMonth.unsure}</span> ·{' '}
                <span className="text-mismatch">⚠ {aiMonth.off}</span> პოზიცია
              </p>
              <p className="text-xs text-ink-faint" title="ფასები: სავარაუდო, ტოკენების მიხედვით">
                ხარჯი ≈ ${(aiMonth.usd + aiMonth.other).toFixed(2)}
                {aiMonth.other > 0 && (
                  <span>
                    {' '}
                    (შემოწმება ${aiMonth.usd.toFixed(2)} · ასისტენტი და ამოცნობა $
                    {aiMonth.other.toFixed(2)})
                  </span>
                )}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Warehouses of the open cycle */}
      {pools.length > 0 && (
        <Card title="საწყობები · მიმდინარე ციკლი">
          <div className="grid gap-1 overflow-x-auto text-sm">
            <div className="grid min-w-[44rem] grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_0.7fr] gap-3 px-2 pb-1 text-xs text-ink-faint">
              <span>საწყობი</span>
              <span>დათვლილი (ნაშთის პროდუქტებიდან)</span>
              <span className="text-right">გამორჩენილი</span>
              <span className="text-right">მეტობა</span>
              <span className="text-right">დანაკლისი</span>
              <span className="text-right">AI %</span>
            </div>
            {pools.map((p) => (
              <Link
                key={p.ids.join()}
                href={`/manage/stocktakes/pool?kind=missed&ids=${p.ids.join(',')}`}
                className="grid min-w-[44rem] grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_0.7fr] items-center gap-3 rounded-xl px-2 py-2 hover:bg-paper"
              >
                <span className="min-w-0">
                  <b className="block truncate">{p.name}</b>
                  <span className="block truncate text-xs text-ink-faint">
                    {p.cycle ?? ''} · {p.ids.length} ინვ.
                  </span>
                </span>
                <span className="grid gap-1">
                  <span className="h-2 overflow-hidden rounded-full bg-[#e4e9e6]">
                    <span className="block h-full bg-[#1f7a4d]" style={{ width: `${p.pct}%` }} />
                  </span>
                  <span className="text-xs tabular-nums text-ink-soft">
                    {p.pct}% · {p.book - Math.min(p.missed, p.book)} / {p.book}
                  </span>
                </span>
                <span className="text-right tabular-nums text-[#5b21b6]">
                  {p.missed} SKU
                  <span className="block text-xs">{gel(p.missedSum)}</span>
                </span>
                <span className="text-right tabular-nums text-[#2563eb]">
                  +{p.plusQty}
                  <span className="block text-xs">{gel(p.plusSum)}</span>
                </span>
                <span className="text-right tabular-nums text-mismatch">
                  −{p.minusQty}
                  <span className="block text-xs">−{gel(p.minusSum)}</span>
                </span>
                <span className="text-right tabular-nums">
                  {p.ai ? (
                    <span className={p.ai.matched === p.ai.checked ? 'text-match' : 'text-review'}>
                      {p.ai.pct}%
                      <span className="block text-xs text-ink-faint">
                        {p.ai.matched}/{p.ai.checked}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            ერთი საწყობის ციკლის ყველა ინვენტარიზაცია ერთ დათვლად ითვლება და მთელ ნაშთს ედარება —
            იგივე ციფრები, რაც ინვენტარიზაციების სიაში. ზოლზე დაჭერით გამორჩენილი პროდუქტების სია
            იხსნება.
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Current stocktakes */}
        <Card
          title="მიმდინარე"

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
