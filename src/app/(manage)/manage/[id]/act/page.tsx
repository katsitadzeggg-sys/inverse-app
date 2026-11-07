import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import PrintButton from './print-button';

type Book = { product_id: string; book_qty: number; unit_cost: number | null };
type Entry = { product_id: string | null; unknown_label: string | null; quantity: number };

const fmt = (n: number) => Number(n).toLocaleString('ka-GE', { maximumFractionDigits: 3 });
const money = (n: number) =>
  n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const unitLabel = (u?: string | null) => (!u || u === 'pcs' ? 'ც' : u);

async function all<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Stock count act (comparison statement): every product with book quantity,
 * counted quantity, surplus and shortage, totals, the counting team, and
 * lines for signatures. Printed from the browser (or saved as PDF).
 */
export default async function StockAct({ params }: PageProps<'/manage/[id]/act'>) {
  const { id } = await params;
  await requireSession();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();
  if (st.kind === 'assets') redirect(`/count/${id}/report`);

  const [book, entries, { data: zones }] = await Promise.all([
    all<Book>((a, b) =>
      supabase
        .from('stocktake_book')
        .select('product_id, book_qty, unit_cost')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    all<Entry>((a, b) =>
      supabase
        .from('stocktake_entries')
        .select('product_id, unknown_label, quantity')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    supabase
      .from('stocktake_zones')
      .select('user_profiles (full_name, email)')
      .eq('stocktake_id', id)
      .returns<{ user_profiles: { full_name: string | null; email: string } | null }[]>(),
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
    if (!e.product_id) {
      unknown.push(e);
      continue;
    }
    const r = rows.get(e.product_id) ?? { book: 0, counted: 0, cost: null };
    r.counted += Number(e.quantity);
    rows.set(e.product_id, r);
  }
  const ids = [...rows.keys()];
  const info = new Map<
    string,
    { name: string; sku: string; barcode: string | null; unit: string }
  >();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, barcode, unit')
      .in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) info.set(p.id, p);
  }
  const list = [...rows.entries()]
    .map(([pid, r]) => ({ pid, ...r, diff: r.counted - r.book, ...info.get(pid)! }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ka'));
  const hasCost = list.some((r) => r.cost != null);

  const t = { book: 0, counted: 0, plus: 0, minus: 0, plusV: 0, minusV: 0 };
  for (const r of list) {
    t.book += r.book;
    t.counted += r.counted;
    if (r.diff > 0) {
      t.plus += r.diff;
      t.plusV += r.diff * (r.cost ?? 0);
    }
    if (r.diff < 0) {
      t.minus += -r.diff;
      t.minusV += -r.diff * (r.cost ?? 0);
    }
  }
  const matched = list.filter((r) => r.diff === 0).length;
  const team = [
    ...new Set(
      (zones ?? [])
        .map((z) => z.user_profiles?.full_name ?? z.user_profiles?.email)
        .filter(Boolean),
    ),
  ] as string[];
  const date = new Date(st.count_date).toLocaleDateString('ka-GE');
  const cell = 'border border-gray-400 px-1.5 py-1';

  return (
    <div className="grid gap-4">
      <div className="no-print flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href={`/manage/${id}`}
          className="rounded-control border border-rule-strong px-4 py-2 text-base font-medium"
        >
          ← დაბრუნება
        </Link>
        <PrintButton />
      </div>

      <article
        id="stock-act"
        className="mx-auto w-full max-w-4xl bg-white p-6 text-[13px] text-black"
      >
        <header className="grid gap-1 text-center">
          <h1 className="text-lg font-bold">მარაგების ინვენტარიზაციის აქტი № {st.number}</h1>
          <p>შედარებითი უწყისი (აღრიცხვა — ფაქტობრივი ნაშთი)</p>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <dt className="text-gray-600">ორგანიზაცია:</dt>
          <dd className="font-semibold">{st.client_name ?? st.name}</dd>
          {st.branch && (
            <>
              <dt className="text-gray-600">საწყობი / ობიექტი:</dt>
              <dd>{st.branch}</dd>
            </>
          )}
          {st.address && (
            <>
              <dt className="text-gray-600">მისამართი:</dt>
              <dd>{st.address}</dd>
            </>
          )}
          <dt className="text-gray-600">ინვენტარიზაციის თარიღი:</dt>
          <dd>{date}</dd>
          {team.length > 0 && (
            <>
              <dt className="text-gray-600">აღმწერები:</dt>
              <dd>{team.join(', ')}</dd>
            </>
          )}
        </dl>

        <table className="mt-4 w-full border-collapse">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className={cell}>№</th>
              <th className={cell}>დასახელება</th>
              <th className={cell}>შტრიხკოდი</th>
              <th className={cell}>ერთ.</th>
              {hasCost && <th className={`${cell} text-right`}>ფასი</th>}
              <th className={`${cell} text-right`}>აღრიცხვით</th>
              <th className={`${cell} text-right`}>ფაქტობრივად</th>
              <th className={`${cell} text-right`}>მეტობა</th>
              <th className={`${cell} text-right`}>დანაკლისი</th>
              {hasCost && <th className={`${cell} text-right`}>სხვაობა ₾</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.pid} className="break-inside-avoid">
                <td className={cell}>{i + 1}</td>
                <td className={cell}>{r.name}</td>
                <td className={`${cell} tabular-nums`}>{r.barcode ?? r.sku}</td>
                <td className={cell}>{unitLabel(r.unit)}</td>
                {hasCost && (
                  <td className={`${cell} text-right tabular-nums`}>
                    {r.cost != null ? money(r.cost) : ''}
                  </td>
                )}
                <td className={`${cell} text-right tabular-nums`}>{fmt(r.book)}</td>
                <td className={`${cell} text-right tabular-nums`}>{fmt(r.counted)}</td>
                <td className={`${cell} text-right tabular-nums`}>
                  {r.diff > 0 ? fmt(r.diff) : ''}
                </td>
                <td className={`${cell} text-right tabular-nums`}>
                  {r.diff < 0 ? fmt(-r.diff) : ''}
                </td>
                {hasCost && (
                  <td className={`${cell} text-right tabular-nums`}>
                    {r.diff && r.cost != null ? money(r.diff * r.cost) : ''}
                  </td>
                )}
              </tr>
            ))}
            {unknown.map((u, i) => (
              <tr key={`u${i}`}>
                <td className={cell}>{list.length + i + 1}</td>
                <td className={cell}>❓ {u.unknown_label}</td>
                <td className={cell} />
                <td className={cell}>ც</td>
                {hasCost && <td className={cell} />}
                <td className={`${cell} text-right`}>0</td>
                <td className={`${cell} text-right tabular-nums`}>{fmt(u.quantity)}</td>
                <td className={`${cell} text-right tabular-nums`}>{fmt(u.quantity)}</td>
                <td className={cell} />
                {hasCost && <td className={cell} />}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-100 font-semibold">
            <tr>
              <td className={cell} colSpan={hasCost ? 5 : 4}>
                სულ
              </td>
              <td className={`${cell} text-right tabular-nums`}>{fmt(t.book)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmt(t.counted)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmt(t.plus)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmt(t.minus)}</td>
              {hasCost && (
                <td className={`${cell} text-right tabular-nums`}>{money(t.plusV - t.minusV)}</td>
              )}
            </tr>
          </tfoot>
        </table>

        <p className="mt-3">
          სულ პოზიცია: <b>{list.length + unknown.length}</b> · ემთხვევა: <b>{matched}</b> · მეტობა:{' '}
          <b>{list.filter((r) => r.diff > 0).length + unknown.length}</b> · დანაკლისი:{' '}
          <b>{list.filter((r) => r.diff < 0).length}</b>
          {hasCost && (
            <>
              {' '}
              · მეტობა <b>{money(t.plusV)} ₾</b> · დანაკლისი <b>{money(t.minusV)} ₾</b>
            </>
          )}
        </p>

        <section className="mt-8 grid gap-6 break-inside-avoid">
          {[
            'კომისიის თავმჯდომარე',
            'კომისიის წევრი',
            'კომისიის წევრი',
            'მატერიალურად პასუხისმგებელი პირი',
          ].map((role, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_8rem] items-end gap-4">
              <span>{role}:</span>
              <span className="border-b border-black" />
              <span className="border-b border-black text-center text-xs text-gray-500">
                ხელმოწერა
              </span>
            </div>
          ))}
          <p className="text-xs text-gray-600">
            მატერიალურად პასუხისმგებელი პირი ადასტურებს, რომ ინვენტარიზაცია ჩატარდა მისი
            თანდასწრებით და პრეტენზია არ გააჩნია.
          </p>
        </section>
      </article>
    </div>
  );
}
