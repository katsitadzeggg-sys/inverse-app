import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, Stat } from '@/components/ui';
import type { Stocktake } from '@/types/database';
import { stockActData } from '@/lib/stock-act';
import GlobalSearch from './global-search';
import StocktakePicker from './stocktake-picker';
import TopbarSlot from '@/components/topbar-slot';
import { cycleName } from '@/lib/cycles';
import { aiCost } from '@/lib/ai-usage';
import { VISION_MODEL } from '@/lib/verification/analyze';

export const metadata = { title: 'მთავარი' };

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
export default async function ManageDashboard({ searchParams }: PageProps<'/manage'>) {
  const sp = await searchParams;
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
  const stockIds = all.filter((s) => s.kind !== 'assets').map((s) => s.id);
  const cycleIdList = [
    ...new Set(
      all
        .filter((s) => s.kind !== 'assets')
        .map((s) => s.cycle_id)
        .filter((x): x is string => !!x),
    ),
  ];
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  // The stocktake the dashboard is about: chosen in the header (?st=), else the
  // newest open stock count, else the newest stock count.
  const wanted = typeof sp.st === 'string' ? sp.st : undefined;
  const latest =
    all.find((s) => s.id === wanted) ??
    open.find((s) => s.kind !== 'assets') ??
    all.find((s) => s.kind !== 'assets');
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const checksP = Promise.resolve(
    openIds.length
      ? supabase
          .from('stocktake_checks')
          .select('stocktake_id, location_id, status')
          .in('stocktake_id', openIds)
          .neq('status', 'ok')
          .limit(5000)
          .returns<{ stocktake_id: string; location_id: string; status: string }[]>()
      : { data: [] as { stocktake_id: string; location_id: string; status: string }[] },
  );
  const bookLocP = Promise.resolve(
    latest
      ? supabase
          .from('stocktake_book')
          .select('location_id')
          .eq('stocktake_id', latest.id)
          .not('location_id', 'is', null)
          .limit(20000)
          .returns<{ location_id: string }[]>()
      : { data: [] as { location_id: string }[] },
  );
  const aiSelP = Promise.resolve(
    latest
      ? supabase
          .from('shelf_ai_checks')
          .select('location_id, result, created_at')
          .eq('stocktake_id', latest.id)
          .order('created_at', { ascending: false })
          .limit(2000)
          .returns<
            {
              location_id: string | null;
              result: { items?: { status: string }[] } | null;
              created_at: string;
            }[]
          >()
      : {
          data: [] as {
            location_id: string | null;
            result: { items?: { status: string }[] } | null;
            created_at: string;
          }[],
        },
  );
  const expiryP = Promise.resolve(
    openIds.length
      ? supabase
          .from('stocktake_entries')
          .select('quantity, expiry_date, products (name)')
          .in('stocktake_id', openIds)
          .not('expiry_date', 'is', null)
          .lte('expiry_date', in30.toISOString().slice(0, 10))
          .order('expiry_date')
          .limit(500)
          .returns<{ quantity: number; expiry_date: string; products: { name: string } | null }[]>()
      : {
          data: [] as {
            quantity: number;
            expiry_date: string;
            products: { name: string } | null;
          }[],
        },
  );
  // Everything below depends only on the list above: start it all at once
  // (one wait instead of a chain of round trips to the database).
  const cyclesP = Promise.resolve(
    cycleIdList.length
      ? supabase
          .from('count_cycles')
          .select('id, started_at, closed_at, name, code')
          .in('id', cycleIdList)
      : { data: [] as never[] },
  );
  const aiSumP = Promise.resolve(
    stockIds.length ? supabase.rpc('stocktake_ai_summary', { p_ids: stockIds }) : { data: [] },
  );
  const aiChecksP = Promise.resolve(
    supabase
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
      >(),
  );
  const usageP = Promise.resolve(
    supabase
      .from('ai_usage')
      .select('model, input_tokens, output_tokens')
      .gte('created_at', monthStart.toISOString())
      .limit(20000)
      .returns<{ model: string; input_tokens: number; output_tokens: number }[]>(),
  );
  const actP = latest ? stockActData(supabase, latest.id).catch(() => null) : Promise.resolve(null);
  const entriesP = Promise.resolve(
    supabase
      .from('stocktake_entries')
      .select('counter_id, created_at')
      .gte('created_at', weekAgo.toISOString())
      .limit(20000)
      .returns<{ counter_id: string | null; created_at: string }[]>(),
  );
  const profsP = Promise.resolve(
    supabase
      .from('user_profiles')
      .select('id, full_name, email')
      .returns<{ id: string; full_name: string | null; email: string }[]>(),
  );

  const [{ data: zones }, { data: _team }] = await Promise.all([
    openIds.length
      ? supabase
          .from('stocktake_zones')
          .select(
            'stocktake_id, location_id, status, done_at, started_at, locations (code), user_profiles (full_name, email)',
          )
          .in('stocktake_id', openIds)
          .order('started_at', { ascending: false })
          .limit(2000)
          .returns<
            {
              stocktake_id: string;
              location_id: string;
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
  const { data: cycles } = await cyclesP;
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
  const { data: aiSum } = await aiSumP;
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
  // Photo checks this month, and what they cost.
  const { data: aiChecks } = await aiChecksP;
  const aiMonth = { checks: 0, usd: 0, other: 0, match: 0, unsure: 0, off: 0 };
  // The assistant and photo identification (table from migration 0067; empty before it).
  const { data: usageRows } = await usageP;
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
  const act = await actP;
  const top = act
    ? act.lines
        .filter((l) => l.diff < 0)
        .map((l) => ({ ...l, loss: -l.diff * (l.cost ?? 0) }))
        .sort((a, b) => b.loss - a.loss || a.diff - b.diff)
        .slice(0, 8)
    : [];
  // Speed: lines per hour per counting employee over the last 7 days
  // (time between the first and last line of each day).
  const [{ data: recentEntries }, { data: profs }] = await Promise.all([entriesP, profsP]);
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

  // ---- Needs attention, shelf map, ready to close, expiry, team now ----
  const [{ data: checks }, { data: bookLocs }, { data: aiSel }, { data: expiring }] =
    await Promise.all([checksP, bookLocP, aiSelP, expiryP]);
  const chk = checks ?? [];
  const frozen = chk.filter((c) => c.status === 'frozen');
  const recount = chk.filter((c) => c.status === 'recount');
  const missedSkus = pools.reduce((n, p) => n + p.missed, 0);
  const missedSum = pools.reduce((n, p) => n + p.missedSum, 0);
  const firstWith = (rows: { stocktake_id: string }[]) => rows[0]?.stocktake_id ?? latest?.id;
  // Shelves of the chosen stocktake: those of its balance and those counted.
  type Cell = {
    id: string;
    code: string;
    state: 'done' | 'counting' | 'recount' | 'alert' | 'todo';
  };
  const selZones = latest ? z.filter((r) => r.stocktake_id === latest.id) : [];
  const shelfIds = new Set<string>([
    ...(bookLocs ?? []).map((b) => b.location_id),
    ...selZones.map((r) => r.location_id),
  ]);
  const codeOf = new Map(selZones.map((r) => [r.location_id, r.locations?.code ?? '']));
  const missingCodes = [...shelfIds].filter((id) => !codeOf.get(id));
  if (missingCodes.length) {
    const { data: locs } = await supabase
      .from('locations')
      .select('id, code')
      .in('id', missingCodes.slice(0, 1000))
      .returns<{ id: string; code: string }[]>();
    for (const l of locs ?? []) codeOf.set(l.id, l.code);
  }
  const aiRed = new Set<string>();
  const aiSeen = new Set<string>();
  for (const c of aiSel ?? []) {
    if (!c.location_id || aiSeen.has(c.location_id)) continue;
    aiSeen.add(c.location_id);
    if ((c.result?.items ?? []).some((it) => it.status === 'mismatch')) aiRed.add(c.location_id);
  }
  const selFrozen = new Set(
    frozen.filter((c) => c.stocktake_id === latest?.id).map((c) => c.location_id),
  );
  const selRecount = new Set(
    recount.filter((c) => c.stocktake_id === latest?.id).map((c) => c.location_id),
  );
  const zoneState = new Map(selZones.map((r) => [r.location_id, r.status]));
  const cells: Cell[] = [...shelfIds]
    .map((id) => {
      const zs = zoneState.get(id);
      const state: Cell['state'] =
        selFrozen.has(id) || aiRed.has(id)
          ? 'alert'
          : selRecount.has(id)
            ? 'recount'
            : zs === 'done'
              ? 'done'
              : zs
                ? 'counting'
                : 'todo';
      return { id, code: codeOf.get(id) || '—', state };
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));
  const cellCount = (k: Cell['state']) => cells.filter((c) => c.state === k).length;
  const CELL: Record<Cell['state'], [string, string]> = {
    done: ['bg-[#1f7a4d]', 'დათვლილი'],
    counting: ['bg-[#8fd3ad]', 'ითვლება'],
    recount: ['bg-[#f59e0b]', 'გადათვლა'],
    alert: ['bg-mismatch', 'AI / სხვაობა'],
    todo: ['bg-[#d5dbd8]', 'დაუთვლელი'],
  };
  // Ready to close: every started shelf done, nothing frozen or to recount.
  const ready = open.filter((st) => {
    const p = progress.get(st.id);
    return p && p.all > 0 && p.counting === 0 && !chk.some((c) => c.stocktake_id === st.id);
  });
  // Surpluses, by money, in the chosen stocktake.
  const topPlus = act
    ? act.lines
        .filter((l) => l.diff > 0)
        .map((l) => ({ ...l, gain: l.diff * (l.cost ?? 0) }))
        .sort((a, b) => b.gain - a.gain || b.diff - a.diff)
        .slice(0, 10)
    : [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const expired = (expiring ?? []).filter((e) => e.expiry_date < todayIso);
  const soon = (expiring ?? []).filter((e) => e.expiry_date >= todayIso);
  // Team right now: who is on which shelf; lines counted today.
  const nowOn = z
    .filter((r) => r.status !== 'done')
    .slice(0, 8)
    .map((r) => ({
      who: r.user_profiles?.full_name ?? r.user_profiles?.email ?? '—',
      code: r.locations?.code ?? '—',
      st: name.get(r.stocktake_id)?.number ?? '',
      since: r.started_at,
    }));
  const todayLines = new Map<string, number>();
  for (const e of recentEntries ?? []) {
    if (!e.counter_id || new Date(e.created_at) < today) continue;
    todayLines.set(e.counter_id, (todayLines.get(e.counter_id) ?? 0) + 1);
  }
  const todayTeam = [...todayLines.entries()]
    .map(([id, n]) => ({ name: people.get(id) ?? '—', n }))
    .sort((a, b) => b.n - a.n);
  const closedCount = all.filter((s) => s.status !== 'open').length;
  const net = money.plus - money.minus;
  const attention = [
    {
      label: 'გაყინული სხვაობა',
      n: frozen.length,
      href: firstWith(frozen) ? `/manage/${firstWith(frozen)}` : '/manage/stocktakes',
    },
    {
      label: 'გადასათვლელი',
      n: recount.length,
      href: firstWith(recount) ? `/manage/${firstWith(recount)}` : '/manage/stocktakes',
    },
    {
      label: 'AI წითელი',
      n: aiRed.size,
      href: latest ? `/manage/${latest.id}/map` : '/manage/stocktakes',
    },
    {
      label: 'დაუთვლელი თარო',
      n: cellCount('todo'),
      href: latest ? `/manage/${latest.id}/map?focus=missed` : '/manage/stocktakes',
    },
  ];

  return (
    <div className="grid gap-4">
      <TopbarSlot>
        <GlobalSearch />
        {open.length > 1 && (
          <StocktakePicker
            key={latest?.id}
            current={latest?.id}
            options={open.map((s) => ({
              id: s.id,
              label: `${s.number} · ${s.branch ?? s.client_name ?? s.name}`,
            }))}
          />
        )}
      </TopbarSlot>
      <div className="rounded-2xl bg-paper-sunk px-5 py-4">
        <h1 className="text-3xl font-semibold tracking-tight">დეშბორდი</h1>
        <p className="mt-1 text-sm text-ink-faint">
          {company.name} · {open.length} მიმდინარე · {closedCount} დასრულებული
        </p>
      </div>

      {/* Zone 1 — overall status */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          featured
          label="დათვლილია"
          value={`${pct}%`}
          hint={`${countedAll} / ${bookAll} პროდუქტი · ${cellCount('done')}/${cells.length} თარო`}
        />
        <Stat
          href="/manage/stocktakes?kind=stock"
          label="ნამდვილი სხვაობა"
          value={gel(net)}
          tone={net < 0 ? 'mismatch' : 'default'}
          hint={`მეტობა +${gel(money.plus)} · დანაკლისი −${gel(money.minus)} · მხოლოდ დათვლილზე`}
        />
        <Stat
          label="დასათვლელი დარჩა"
          value={gel(missedSum)}
          hint={`${missedSkus} პროდუქტი ნაშთიდან · ჯერ სხვაობა არ არის`}
        />
        <Stat
          href="/manage/stocktakes"
          label="ინვენტარიზაციები"
          value={open.length}
          hint={`აქტიური · დასრულებული ${closedCount}`}
        />
      </div>

      {/* Zone 2 — needs attention */}
      <Card title="საჭიროებს ყურადღებას">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {attention.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className={`rounded-xl border px-4 py-3 hover:bg-paper ${
                a.n > 0 ? 'border-mismatch/40 bg-mismatch/5' : 'border-rule'
              }`}
            >
              <span className="block text-xs text-ink-faint">{a.label}</span>
              <span
                className={`block text-2xl font-semibold tabular-nums ${a.n > 0 ? 'text-mismatch' : 'text-ink-soft'}`}
              >
                {a.n}
              </span>
            </Link>
          ))}
        </div>
        {ready.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#bfe3cd] bg-[#eef7f1] px-4 py-3 text-sm">
            <span className="font-semibold text-[#155c39]">მზადაა დასახურად:</span>
            {ready.map((st) => (
              <Link
                key={st.id}
                href={`/manage/${st.id}`}
                className="rounded-full border border-[#1f7a4d] px-3 py-1 text-xs font-medium text-[#155c39] hover:bg-white"
              >
                {st.number} · {st.branch ?? st.client_name ?? st.name} →
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Zone 3 — shelf map + AI control */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title={`თაროები${latest ? ` · ${latest.number}` : ''}`}
          className="xl:col-span-2"
          action={
            latest && (
              <Link
                href={`/manage/${latest.id}/map`}
                className="rounded-full border border-ink/70 px-3 py-1 text-xs font-medium hover:bg-ink/5"
              >
                3D რუკა →
              </Link>
            )
          }
        >
          {cells.length === 0 ? (
            <p className="text-sm text-ink-faint">ამ აღწერაში თაროები ჯერ არ არის.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {cells.map((c) => (
                  <span
                    key={c.id}
                    className={`grid h-7 min-w-11 place-items-center rounded-md px-1 text-[10px] font-medium ${CELL[c.state][0]} ${
                      c.state === 'todo' || c.state === 'counting' ? 'text-ink-soft' : 'text-white'
                    }`}
                    title={`${c.code} · ${CELL[c.state][1]}`}
                  >
                    {c.code}
                  </span>
                ))}
              </div>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                {(Object.keys(CELL) as Cell['state'][]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm ${CELL[k][0]}`} />
                    {CELL[k][1]} {cellCount(k)}
                  </span>
                ))}
              </p>
            </>
          )}
        </Card>

        <Card title="AI კონტროლი · ეს თვე">
          {aiMonth.checks === 0 ? (
            <p className="text-sm text-ink-faint">ამ თვეში ფოტოებით შემოწმება არ ყოფილა.</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-3xl font-semibold tabular-nums text-[#1e3a8a]">
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
                <span className="text-match">✓ ემთხვევა {aiMonth.match}</span> ·{' '}
                <span className="text-review">? ვერ ჩანს {aiMonth.unsure}</span> ·{' '}
                <span className="text-mismatch">⚠ არ ემთხვევა {aiMonth.off}</span>
              </p>
              <p className="text-xs text-ink-faint">
                „არ ემთხვევა“ — სადაც AI-მ ფოტოზე სხვა რაოდენობა დაინახა, ვიდრე მთვლელმა ჩაწერა.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Zone 4 — money and expiry */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`დანაკლისი${latest ? ` · ${latest.number}` : ''}`}>
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
                    {l.loss ? `−${gel(l.loss)}` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`მეტობა${latest ? ` · ${latest.number}` : ''}`}>
          {topPlus.length === 0 ? (
            <p className="text-sm text-ink-faint">მეტობა არ არის.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {topPlus.map((l) => (
                <li key={l.n} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span className="truncate" title={l.name}>
                    {l.name}
                  </span>
                  <span className="tabular-nums text-[#2563eb]">+{l.diff}</span>
                  <span className="w-20 text-right tabular-nums text-ink-soft">
                    {l.gain ? `+${gel(l.gain)}` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="ვადები">
          {expired.length + soon.length === 0 ? (
            <p className="text-sm text-ink-faint">30 დღეში ვადაგასული პროდუქტი არ ჩაწერილა.</p>
          ) : (
            <div className="grid gap-3 text-sm">
              <p>
                <span className="font-semibold text-mismatch">{expired.length}</span> ვადაგასული ·{' '}
                <span className="font-semibold text-review">{soon.length}</span> 30 დღეში
              </p>
              <ul className="grid gap-1.5">
                {[...expired, ...soon].slice(0, 8).map((e, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto_auto] gap-3">
                    <span className="truncate">{e.products?.name ?? '—'}</span>
                    <span className="tabular-nums text-ink-soft">{e.quantity}</span>
                    <span
                      className={`tabular-nums ${e.expiry_date < todayIso ? 'text-mismatch' : 'text-review'}`}
                    >
                      {e.expiry_date.slice(5).split('-').reverse().join('.')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Zone 5 — team now */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="ახლა ითვლება">
          {nowOn.length === 0 ? (
            <p className="text-sm text-ink-faint">ამ წუთას არავინ ითვლის.</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {nowOn.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">
                    <b>{r.who}</b> · თარო {r.code}
                    <span className="block text-xs text-ink-faint">{r.st}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                    {time(r.since)}-დან
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="გუნდი · დღეს და სისწრაფე">
          {todayTeam.length === 0 && speed.length === 0 ? (
            <p className="text-sm text-ink-faint">ბოლო 7 დღეში დათვლა არ ყოფილა.</p>
          ) : (
            <ul className="grid gap-3">
              {(todayTeam.length ? todayTeam : speed.map((v) => ({ name: v.name, n: 0 })))
                .slice(0, 6)
                .map((v, i) => {
                  const sp7 = speed.find((x) => x.name === v.name);
                  return (
                    <li key={v.name} className="flex items-center gap-3">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink"
                        style={{ background: AV[i % AV.length] }}
                      >
                        {initials(v.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.name}</span>
                        <span className="block text-xs text-ink-faint">
                          დღეს {v.n} ხაზი{sp7 ? ` · 7 დღეში ${sp7.lines}` : ''}
                        </span>
                      </span>
                      {sp7 && (
                        <span className="rounded-md border border-[#bfe3cd] bg-[#eef7f1] px-2 py-0.5 text-xs font-medium tabular-nums text-[#155c39]">
                          {sp7.perHour}/სთ
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      </div>

      {/* Details — folded */}
      <details className="rounded-2xl border border-rule/70 bg-paper-sunk">
        <summary className="cursor-pointer px-5 py-4 text-base font-semibold">
          დეტალები · აქტივობა, საწყობები, ბოლო თაროები, AI ხარჯი
        </summary>
        <div className="grid gap-4 px-5 pb-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="დათვლის აქტივობა · 7 დღე">
              <div className="flex h-40 items-end justify-between gap-3 px-1">
                {days.map((d, i) => {
                  const h = Math.max(18, Math.round((d.n / peak) * 100));
                  const isToday = i === 6;
                  return (
                    <div key={d.key} className="flex flex-1 flex-col items-center gap-2">
                      <div className="relative flex h-32 w-full max-w-14 items-end">
                        {d.n > 0 && (
                          <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-rule bg-paper-sunk px-1.5 text-[10px] tabular-nums text-ink-soft">
                            {d.n}
                          </span>
                        )}
                        <div
                          className={`w-full rounded-full ${
                            d.n === 0
                              ? 'bar-hatch'
                              : isToday
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
                        className={`text-xs ${isToday ? 'font-semibold text-ink' : 'text-ink-faint'}`}
                      >
                        {d.label}
                      </span>
                    </div>
                  );
                })}
              </div>
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
                          {name.get(r.stocktake_id)?.branch ??
                            name.get(r.stocktake_id)?.client_name}
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

          {pools.length > 0 && (
            <Card title="საწყობები · მიმდინარე ციკლი">
              <div className="grid gap-1 overflow-x-auto text-sm">
                <div className="grid min-w-[44rem] grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_0.7fr] gap-3 px-2 pb-1 text-xs text-ink-faint">
                  <span>საწყობი</span>
                  <span>დათვლილი (ნაშთის პროდუქტებიდან)</span>
                  <span className="text-right">დასათვლელი</span>
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
                        <span
                          className="block h-full bg-[#1f7a4d]"
                          style={{ width: `${p.pct}%` }}
                        />
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
                        <span
                          className={p.ai.matched === p.ai.checked ? 'text-match' : 'text-review'}
                        >
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
                „დასათვლელი“ — ნაშთშია, ჯერ არავის დაუთვლია; სხვაობაში არ ითვლება. ზოლზე დაჭერით სია
                იხსნება.
              </p>
            </Card>
          )}

          <p className="text-xs text-ink-faint" title="ფასები: სავარაუდო, ტოკენების მიხედვით">
            AI ხარჯი ამ თვეში ≈ ${(aiMonth.usd + aiMonth.other).toFixed(2)}
            {aiMonth.other > 0 &&
              ` (შემოწმება $${aiMonth.usd.toFixed(2)} · ასისტენტი და ამოცნობა $${aiMonth.other.toFixed(2)})`}
          </p>
        </div>
      </details>
    </div>
  );
}
