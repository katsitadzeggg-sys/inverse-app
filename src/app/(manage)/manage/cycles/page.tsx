import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { cycleLabel } from '@/lib/cycles';
import type { CountCycle, CycleSummary } from '@/types/database';
import CloseCycleButton from './close-button';
import PeriodSelect from './period-select';

export const metadata = { title: 'ციკლები' };

type Line = {
  product_id: string;
  book: number;
  counted: number | null;
  price: number;
  status: string;
};

/** The same figures a closed cycle freezes (see close_count_cycle), for a live one. */
function summarize(lines: Line[], stocktakes: number): CycleSummary {
  const s: CycleSummary = {
    stocktakes,
    closed_open: 0,
    products: lines.length,
    ok: 0,
    missed: 0,
    review: 0,
    book_qty: 0,
    book_value: 0,
    counted_qty: 0,
    shortage_qty: 0,
    shortage_value: 0,
    surplus_qty: 0,
    surplus_value: 0,
    shelves: 0,
  };
  for (const l of lines) {
    if (l.status === 'ok') s.ok++;
    else if (l.status === 'missed') s.missed++;
    else if (l.status === 'review') s.review++;
    const d = Number(l.counted ?? 0) - Number(l.book);
    s.book_qty += Number(l.book);
    s.book_value += Number(l.book) * Number(l.price);
    s.counted_qty += Number(l.counted ?? 0);
    if (d < 0) {
      s.shortage_qty -= d;
      s.shortage_value -= d * Number(l.price);
    } else if (d > 0) {
      s.surplus_qty += d;
      s.surplus_value += d * Number(l.price);
    }
  }
  return s;
}

const gel = (v: number) => `${Math.round(Number(v)).toLocaleString('ka-GE')} ₾`;
const day = (v: string) =>
  new Date(v).toLocaleDateString('ka-GE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'Asia/Tbilisi',
  });
/** Share of products whose count matched the balance. */
const accuracy = (s: CycleSummary) => (s.products ? (s.ok / s.products) * 100 : null);

/**
 * Count cycles (quarters) per warehouse. The open one is live: its stocktakes
 * are one count, with their own missed / to re-check. Closing it freezes the
 * result; the closed ones side by side show how the warehouse is doing over
 * time, and which products come up short again and again.
 */
export default async function CyclesPage() {
  const { profile, company } = await requireSession();
  const period = company.cycle_period ?? 'quarter';
  const manager = profile.role === 'owner' || profile.role === 'admin';
  const supabase = await createClient();
  const [{ data: cyc }, { data: sts }] = await Promise.all([
    supabase
      .from('count_cycles')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(500)
      .returns<CountCycle[]>(),
    supabase
      .from('stocktakes')
      .select('id, cycle_id, status')
      .not('cycle_id', 'is', null)
      .is('archived_at', null)
      .neq('kind', 'assets')
      .limit(5000),
  ]);
  const cycles = cyc ?? [];
  const byCycle = new Map<string, { id: string; status: string }[]>();
  for (const s of sts ?? [])
    byCycle.set(s.cycle_id as string, [...(byCycle.get(s.cycle_id as string) ?? []), s]);

  // Live figures of the open cycles.
  const live = new Map<string, CycleSummary>();
  await Promise.all(
    cycles
      .filter((c) => !c.closed_at)
      .map(async (c) => {
        const ids = (byCycle.get(c.id) ?? []).map((s) => s.id);
        if (!ids.length) return;
        const { data } = await supabase.rpc('pool_lines', { p_ids: ids });
        const lines = (
          (data ?? []) as {
            product_id: string;
            cur_qty: number;
            ref_qty: number | null;
            counted_qty: number | null;
            price: number;
            status: string;
          }[]
        ).map((l) => ({
          product_id: l.product_id,
          book: Number(l.ref_qty ?? l.cur_qty ?? 0),
          counted: l.counted_qty,
          price: Number(l.price ?? 0),
          status: l.status,
        }));
        live.set(c.id, summarize(lines, ids.length));
      }),
  );

  // Products short in two or more closed cycles of the same warehouse.
  const closedIds = cycles.filter((c) => c.closed_at).map((c) => c.id);
  const { data: shortLines } = closedIds.length
    ? await supabase
        .from('count_cycle_lines')
        .select('cycle_id, product_id, book, counted, price, status')
        .in('cycle_id', closedIds)
        .neq('status', 'ok')
        .limit(30000)
    : { data: [] };
  const whOf = new Map(cycles.map((c) => [c.id, c.warehouse]));
  type Rep = { pid: string; cycles: Set<string>; qty: number; value: number };
  const repeat = new Map<string, Map<string, Rep>>(); // warehouse → product
  for (const l of shortLines ?? []) {
    const d = Number(l.counted ?? 0) - Number(l.book);
    if (d >= 0) continue;
    const wh = whOf.get(l.cycle_id as string)!;
    const m = repeat.get(wh) ?? new Map<string, Rep>();
    repeat.set(wh, m);
    const r = m.get(l.product_id as string) ?? {
      pid: l.product_id as string,
      cycles: new Set<string>(),
      qty: 0,
      value: 0,
    };
    r.cycles.add(l.cycle_id as string);
    r.qty -= d;
    r.value -= d * Number(l.price);
    m.set(r.pid, r);
  }
  const repIds = [...repeat.values()].flatMap((m) =>
    [...m.values()].filter((r) => r.cycles.size >= 2).map((r) => r.pid),
  );
  const { data: repProds } = repIds.length
    ? await supabase
        .from('products')
        .select('id, name, sku, barcode')
        .in('id', repIds.slice(0, 1000))
    : { data: [] };
  const prodName = new Map((repProds ?? []).map((p) => [p.id, p]));

  const warehouses = [...new Set(cycles.map((c) => c.warehouse))].sort((a, b) =>
    a.localeCompare(b, 'ka'),
  );

  return (
    <div className="grid gap-5 rounded-2xl bg-paper-sunk p-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">აღწერის ციკლები</h1>
          {manager && <PeriodSelect value={period} />}
        </div>
        <p className="text-sm text-ink-soft">
          ციკლი = ერთი აღწერა საწყობში (თვე, კვარტალი ან წელი — როგორც ითვლით). იწყება პირველივე
          ინვენტარიზაციით, მთავრდება, როცა დახურავ. ღია ციკლის ყველა ინვენტარიზაცია ერთად ითვლება —
          გამორჩენილი და გადასამოწმებელი მხოლოდ მისია. დახურვისას შედეგი ფიქსირდება, ხოლო შემდეგი
          ინვენტარიზაცია ახალ ციკლს იწყებს.
        </p>
      </div>
      {warehouses.length === 0 && <p className="text-ink-soft">ჯერ არცერთი ციკლი არ არის.</p>}
      {warehouses.map((wh) => {
        const list = cycles.filter((c) => c.warehouse === wh);
        const reps = [...(repeat.get(wh)?.values() ?? [])]
          .filter((r) => r.cycles.size >= 2)
          .sort((a, b) => b.cycles.size - a.cycles.size || b.value - a.value)
          .slice(0, 15);
        return (
          <section key={wh} className="grid gap-3 rounded-xl bg-paper p-4">
            <h2 className="text-lg font-semibold">{wh}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs text-ink-faint">
                  <tr>
                    <th className="py-1 pr-3">ციკლი</th>
                    <th className="pr-3">პერიოდი</th>
                    <th className="pr-3 text-right">ინვ.</th>
                    <th className="pr-3 text-right">პროდუქტი</th>
                    <th className="pr-3 text-right">სიზუსტე</th>
                    <th className="pr-3 text-right">ნაკლებობა</th>
                    <th className="pr-3 text-right">ზედმეტობა</th>
                    <th className="pr-3 text-right">გამორჩენილი</th>
                    <th className="pr-3 text-right">გადასამოწმ.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((c, i) => {
                    const s = c.closed_at ? c.summary : live.get(c.id);
                    const acc = s ? accuracy(s) : null;
                    // Change of accuracy against the previous (older) cycle.
                    const prev = list[i + 1];
                    const ps = prev ? (prev.closed_at ? prev.summary : live.get(prev.id)) : null;
                    const pacc = ps ? accuracy(ps) : null;
                    const delta = acc != null && pacc != null ? acc - pacc : null;
                    const openSt = (byCycle.get(c.id) ?? []).filter(
                      (x) => x.status === 'open',
                    ).length;
                    return (
                      <tr key={c.id} className="border-t border-rule/70 align-middle">
                        <td className="py-2 pr-3 font-semibold">
                          {cycleLabel(c.started_at, period)}
                          {!c.closed_at && (
                            <span className="ml-2 rounded-full bg-match/15 px-2 py-0.5 text-xs font-medium text-match">
                              მიმდინარე
                            </span>
                          )}
                        </td>
                        <td className="pr-3 tabular-nums">
                          {day(c.started_at)} → {c.closed_at ? day(c.closed_at) : '…'}
                        </td>
                        <td className="pr-3 text-right tabular-nums">
                          {s?.stocktakes ?? (byCycle.get(c.id) ?? []).length}
                        </td>
                        <td className="pr-3 text-right tabular-nums">{s?.products ?? '—'}</td>
                        <td className="pr-3 text-right tabular-nums">
                          {acc != null ? `${acc.toFixed(1)}%` : '—'}
                          {delta != null && Math.abs(delta) >= 0.1 && (
                            <span
                              className={`ml-1 text-xs ${delta > 0 ? 'text-match' : 'text-mismatch'}`}
                            >
                              {delta > 0 ? '▲' : '▼'}
                              {Math.abs(delta).toFixed(1)}
                            </span>
                          )}
                        </td>
                        <td className="pr-3 text-right tabular-nums text-mismatch">
                          {s ? gel(s.shortage_value) : '—'}
                        </td>
                        <td className="pr-3 text-right tabular-nums text-[#2563eb]">
                          {s ? gel(s.surplus_value) : '—'}
                        </td>
                        <td className="pr-3 text-right tabular-nums text-[#5b21b6]">
                          {s?.missed ?? '—'}
                        </td>
                        <td className="pr-3 text-right tabular-nums text-[#b45309]">
                          {s?.review ?? '—'}
                        </td>
                        <td className="py-2 text-right">
                          {!c.closed_at && manager && (byCycle.get(c.id) ?? []).length > 0 && (
                            <CloseCycleButton
                              cycleId={c.id}
                              label={`${wh} · ${cycleLabel(c.started_at, period)}`}
                              open={openSt}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {reps.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  ხშირად აკლია — {reps.length} პროდუქტი ნაკლებობით 2+ ციკლში
                </summary>
                <ul className="mt-2 grid gap-1">
                  {reps.map((r) => {
                    const p = prodName.get(r.pid);
                    return (
                      <li key={r.pid} className="flex flex-wrap gap-x-3">
                        <span className="min-w-0 flex-1">
                          {p?.name ?? '—'}{' '}
                          <span className="text-xs text-ink-faint">{p?.barcode ?? p?.sku}</span>
                        </span>
                        <span className="tabular-nums text-xs">
                          {r.cycles.size} ციკლში · სულ −{Math.round(r.qty * 1000) / 1000} ·{' '}
                          {gel(r.value)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </section>
        );
      })}
      <p className="text-xs text-ink-faint">
        სიზუსტე = პროდუქციის წილი, რომლის დათვლილი ემთხვევა ნაშთს. მიმდინარე ციკლის ციფრები
        ცოცხალია, დახურულისა — დახურვის მომენტისაა.{' '}
        <Link href="/manage/stocktakes" className="underline">
          ინვენტარიზაციები →
        </Link>
      </p>
    </div>
  );
}
