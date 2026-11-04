import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';

type Book = { product_id: string; book_qty: number; unit_cost: number | null };
type Entry = { product_id: string | null; unknown_label: string | null; quantity: number; location_id: string };
type Check = { product_id: string; location_id: string; status: string; attempts: number };

const fmt = (n: number) => Number(n).toLocaleString('ka-GE', { maximumFractionDigits: 3 });
const money = (n: number) => `${n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ₾`;

/** Supabase returns at most 1000 rows per request; read on until the end. */
async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

type Row = { pid: string; book: number; counted: number; diff: number; name?: string; sku?: string };

function Table({ items, tone }: { items: Row[]; tone: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-faint">
          <tr><th className="py-1 pr-2">პროდუქტი</th><th className="px-2 text-right">ნაშთი</th><th className="px-2 text-right">დათვლა</th><th className="pl-2 text-right">სხვაობა</th></tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.pid} className="border-t border-rule/60">
              <td className="py-1.5 pr-2">{r.name}<span className="block text-xs text-ink-faint">{r.sku}</span></td>
              <td className="px-2 text-right tabular-nums">{fmt(r.book)}</td>
              <td className="px-2 text-right tabular-nums">{fmt(r.counted)}</td>
              <td className={`pl-2 text-right font-semibold tabular-nums ${tone}`}>{r.diff > 0 ? '+' : ''}{fmt(r.diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The manager's comparison: counted against book for the whole stocktake.
 * Red first, then items nobody counted (missed), items counted but not in the
 * book, unknown items, and the final recheck list (frozen after 3 recounts).
 */
export default async function ReportPage({ params }: PageProps<'/count/[id]/report'>) {
  const { id } = await params;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: stocktake } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!stocktake) notFound();

  const [book, entries, checks] = await Promise.all([
    all<Book>((a, b) => supabase.from('stocktake_book').select('product_id, book_qty, unit_cost').eq('stocktake_id', id).range(a, b)),
    all<Entry>((a, b) => supabase.from('stocktake_entries').select('product_id, unknown_label, quantity, location_id').eq('stocktake_id', id).range(a, b)),
    all<Check>((a, b) => supabase.from('stocktake_checks').select('product_id, location_id, status, attempts').eq('stocktake_id', id).eq('status', 'frozen').range(a, b)),
  ]);

  const rows = new Map<string, { book: number; counted: number; cost: number | null }>();
  for (const b of book) {
    const r = rows.get(b.product_id) ?? { book: 0, counted: 0, cost: null };
    r.book += Number(b.book_qty);
    r.cost = b.unit_cost ?? r.cost;
    rows.set(b.product_id, r);
  }
  const unknown: Entry[] = [];
  for (const e of entries) {
    if (!e.product_id) { unknown.push(e); continue; }
    const r = rows.get(e.product_id) ?? { book: 0, counted: 0, cost: null };
    r.counted += Number(e.quantity);
    rows.set(e.product_id, r);
  }

  const ids = [...rows.keys(), ...checks.map((c) => c.product_id)];
  const names = new Map<string, { name: string; sku: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('products').select('id, name, sku').in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) names.set(p.id, { name: p.name, sku: p.sku });
  }
  const locIds = [...new Set(checks.map((c) => c.location_id))];
  const locs = new Map<string, string>();
  if (locIds.length) {
    const { data } = await supabase.from('locations').select('id, code').in('id', locIds);
    for (const l of data ?? []) locs.set(l.id, l.code);
  }

  const list = [...rows.entries()].map(([pid, r]) => ({ pid, ...r, diff: r.counted - r.book, ...names.get(pid) }));
  const diffs = list.filter((r) => r.diff !== 0 && r.book > 0 && r.counted > 0).sort((a, b) => Math.abs(b.diff * (b.cost ?? 1)) - Math.abs(a.diff * (a.cost ?? 1)));
  const missed = list.filter((r) => r.book > 0 && r.counted === 0);
  const extra = list.filter((r) => r.book === 0 && r.counted > 0);
  const ok = list.filter((r) => r.diff === 0).length;
  const value = list.reduce((s, r) => s + (r.cost != null ? r.diff * r.cost : 0), 0);

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/count/${id}`} className="text-sm text-ink-faint">← {stocktake.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">სხვაობები</h1>
        {book.length === 0 && <p className="mt-2 text-sm text-review">ნაშთი არ არის ჩატვირთული — <Link className="underline" href={`/count/${id}/book`}>ჩატვირთე</Link>.</p>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold text-match">{ok}</p>ემთხვევა</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold text-mismatch">{diffs.length}</p>სხვაობა</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold text-review">{missed.length}</p>გამორჩენილი</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold">{checks.length}</p>გადასამოწმებელი</div>
      </div>
      {value !== 0 && <p className="text-sm">სხვაობა თანხით: <b className={value < 0 ? 'text-mismatch' : 'text-match'}>{money(value)}</b></p>}

      {checks.length > 0 && (
        <section className="grid gap-2 rounded-control border-2 border-mismatch/50 p-4">
          <h2 className="font-semibold">🔒 გადასამოწმებელი (3 ცდის შემდეგ გაყინული)</h2>
          <ul className="grid gap-1 text-sm">
            {checks.map((c) => (
              <li key={`${c.product_id}-${c.location_id}`} className="flex justify-between border-t border-rule/60 py-1.5">
                <span>{names.get(c.product_id)?.name}</span><span className="text-ink-faint">{locs.get(c.location_id)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diffs.length > 0 && <section className="grid gap-2"><h2 className="font-semibold text-mismatch">⚠ სხვაობები</h2><Table items={diffs} tone="text-mismatch" /></section>}
      {missed.length > 0 && <section className="grid gap-2"><h2 className="font-semibold text-review">გამორჩენილი — ნაშთშია, არავის დაუთვლია</h2><Table items={missed} tone="text-review" /></section>}
      {extra.length > 0 && <section className="grid gap-2"><h2 className="font-semibold">დათვლილია, ნაშთში არ არის</h2><Table items={extra} tone="text-ink" /></section>}
      {unknown.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold">❓ უცნობი პროდუქტები</h2>
          <ul className="text-sm">{unknown.map((u, i) => <li key={i} className="border-t border-rule/60 py-1.5">{u.unknown_label} — {fmt(u.quantity)}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
