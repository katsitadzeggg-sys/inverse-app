import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { loadAssetResult } from '@/lib/assets-result';
import AssetReport from './asset-report';
import { EXPIRY_LABEL, expiryStatus, fmtDate, type ExpiryStatus } from '@/lib/expiry';

type Book = {
  product_id: string;
  location_id: string | null;
  book_qty: number;
  unit_cost: number | null;
  expiry_date: string | null;
};
type Entry = {
  product_id: string | null;
  unknown_label: string | null;
  quantity: number;
  location_id: string;
  expiry_date: string | null;
};
type Check = { product_id: string; location_id: string; status: string; attempts: number };

const fmt = (n: number) => Number(n).toLocaleString('ka-GE', { maximumFractionDigits: 3 });
const money = (n: number) =>
  `${n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ₾`;

/** Supabase returns at most 1000 rows per request; read on until the end. */
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

type Row = {
  pid: string;
  book: number;
  counted: number;
  diff: number;
  name?: string;
  sku?: string;
};

function Table({ items, tone }: { items: Row[]; tone: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-faint">
          <tr>
            <th className="py-1 pr-2">პროდუქტი</th>
            <th className="px-2 text-right">ნაშთი</th>
            <th className="px-2 text-right">დათვლა</th>
            <th className="pl-2 text-right">სხვაობა</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.pid} className="border-t border-rule/60">
              <td className="py-1.5 pr-2">
                {r.name}
                <span className="block text-xs text-ink-faint">{r.sku}</span>
              </td>
              <td className="px-2 text-right tabular-nums">{fmt(r.book)}</td>
              <td className="px-2 text-right tabular-nums">{fmt(r.counted)}</td>
              <td className={`pl-2 text-right font-semibold tabular-nums ${tone}`}>
                {r.diff > 0 ? '+' : ''}
                {fmt(r.diff)}
              </td>
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
  const { data: stocktake } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  if (stocktake.kind === 'assets') {
    return (
      <AssetReport id={id} number={stocktake.number} rows={await loadAssetResult(supabase, id)} />
    );
  }

  const { data: zones } = await supabase
    .from('stocktake_zones')
    .select(
      'id, status, note, started_at, done_at, locations (code), user_profiles (full_name, email)',
    )
    .eq('stocktake_id', id)
    .order('started_at')
    .returns<
      {
        id: string;
        status: string;
        note: string | null;
        started_at: string;
        done_at: string | null;
        locations: { code: string } | null;
        user_profiles: { full_name: string | null; email: string } | null;
      }[]
    >();

  const [book, entries, checks] = await Promise.all([
    all<Book>((a, b) =>
      supabase
        .from('stocktake_book')
        .select('product_id, location_id, book_qty, unit_cost, expiry_date')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    all<Entry>((a, b) =>
      supabase
        .from('stocktake_entries')
        .select('product_id, unknown_label, quantity, location_id, expiry_date')
        .eq('stocktake_id', id)
        .range(a, b),
    ),
    all<Check>((a, b) =>
      supabase
        .from('stocktake_checks')
        .select('product_id, location_id, status, attempts')
        .eq('stocktake_id', id)
        .eq('status', 'frozen')
        .range(a, b),
    ),
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

  const ids = [...rows.keys(), ...checks.map((c) => c.product_id)];
  const names = new Map<string, { name: string; sku: string; group: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, categories (name)')
      .in('id', ids.slice(i, i + 300))
      .returns<{ id: string; name: string; sku: string; categories: { name: string } | null }[]>();
    for (const p of data ?? [])
      names.set(p.id, { name: p.name, sku: p.sku, group: p.categories?.name ?? 'ჯგუფის გარეშე' });
  }
  // Found on a shelf other than the one(s) in the book: to be moved back.
  const booked = new Map<string, Set<string>>();
  for (const b of book)
    if (b.location_id)
      booked.set(b.product_id, (booked.get(b.product_id) ?? new Set()).add(b.location_id));
  const moved = new Map<string, { pid: string; loc: string; qty: number }>();
  for (const e of entries) {
    const homes = e.product_id ? booked.get(e.product_id) : undefined;
    if (!e.product_id || !homes || homes.has(e.location_id) || Number(e.quantity) <= 0) continue;
    const k = `${e.product_id}|${e.location_id}`;
    const m = moved.get(k) ?? { pid: e.product_id, loc: e.location_id, qty: 0 };
    m.qty += Number(e.quantity);
    moved.set(k, m);
  }
  // Products created during this count (the counter photographed them).
  const { data: fresh } = await supabase
    .from('products')
    .select('id, name, barcode, sku, image_url')
    .like('image_url', `${stocktake.company_id}/${id}/%`)
    .returns<
      { id: string; name: string; barcode: string | null; sku: string; image_url: string }[]
    >();
  const freshIds = new Set((fresh ?? []).map((p) => p.id));
  const thumbs = new Map<string, string>();
  for (const p of fresh ?? []) {
    const { data } = await supabase.storage
      .from('stocktake-media')
      .createSignedUrl(p.image_url, 60 * 60);
    if (data?.signedUrl) thumbs.set(p.id, data.signedUrl);
  }
  const shelfOf = new Map<string, string>();
  for (const e of entries)
    if (e.product_id && freshIds.has(e.product_id)) shelfOf.set(e.product_id, e.location_id);

  const locIds = [
    ...new Set([
      ...checks.map((c) => c.location_id),
      ...[...moved.values()].map((m) => m.loc),
      ...[...booked.values()].flatMap((x) => [...x]),
      ...shelfOf.values(),
    ]),
  ];
  const locs = new Map<string, string>();
  if (locIds.length) {
    const { data } = await supabase.from('locations').select('id, code').in('id', locIds);
    for (const l of data ?? []) locs.set(l.id, l.code);
  }

  const list = [...rows.entries()].map(([pid, r]) => ({
    pid,
    ...r,
    diff: r.counted - r.book,
    ...names.get(pid),
  }));
  const diffs = list
    .filter((r) => r.diff !== 0 && r.book > 0 && r.counted > 0)
    .sort((a, b) => Math.abs(b.diff * (b.cost ?? 1)) - Math.abs(a.diff * (a.cost ?? 1)));
  const missed = list.filter((r) => r.book > 0 && r.counted === 0);
  const extra = list.filter((r) => r.book === 0 && r.counted > 0 && !freshIds.has(r.pid));
  const ok = list.filter((r) => r.diff === 0).length;
  const value = list.reduce((s, r) => s + (r.cost != null ? r.diff * r.cost : 0), 0);

  // Regrading (გადარევა): within a product group, a surplus of one item may
  // cover a shortage of another (mixed up at receipt or sale). Per group:
  // surplus and shortage in money, the part that offsets, and what is left.
  const regrade = new Map<
    string,
    { plus: number; minus: number; plusQ: number; minusQ: number; items: typeof list }
  >();
  for (const r of list) {
    if (!r.diff || r.cost == null) continue;
    const g = names.get(r.pid)?.group ?? 'ჯგუფის გარეშე';
    const x = regrade.get(g) ?? { plus: 0, minus: 0, plusQ: 0, minusQ: 0, items: [] };
    if (r.diff > 0) {
      x.plus += r.diff * r.cost;
      x.plusQ += r.diff;
    } else {
      x.minus += -r.diff * r.cost;
      x.minusQ += -r.diff;
    }
    x.items.push(r);
    regrade.set(g, x);
  }
  const regradeRows = [...regrade.entries()].sort((a, b) => b[1].minus - a[1].minus);
  const regradeAll = regradeRows.reduce(
    (t, [, x]) => ({
      plus: t.plus + x.plus,
      minus: t.minus + x.minus,
      off: t.off + Math.min(x.plus, x.minus),
    }),
    { plus: 0, minus: 0, off: 0 },
  );

  // Expiry-date count: one line per product and expiry date (batch).
  const isExpiry = stocktake.kind === 'expiry';
  const batches = new Map<
    string,
    { pid: string; expiry: string | null; book: number; counted: number }
  >();
  if (isExpiry) {
    const add = (pid: string, expiry: string | null, book: number, counted: number) => {
      const key = `${pid}|${expiry ?? ''}`;
      const b = batches.get(key) ?? { pid, expiry, book: 0, counted: 0 };
      b.book += book;
      b.counted += counted;
      batches.set(key, b);
    };
    for (const b of book) add(b.product_id, b.expiry_date, Number(b.book_qty), 0);
    for (const e of entries)
      if (e.product_id) add(e.product_id, e.expiry_date, 0, Number(e.quantity));
  }
  const batchRows = [...batches.values()]
    .map((b) => ({
      ...b,
      status: expiryStatus(b.expiry, stocktake.count_date),
      name: names.get(b.pid)?.name ?? '',
      sku: names.get(b.pid)?.sku ?? '',
    }))
    .sort(
      (a, b) =>
        (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') || a.name.localeCompare(b.name),
    );
  const byStatus = new Map<ExpiryStatus, { lines: number; qty: number }>();
  for (const r of batchRows) {
    if (r.counted <= 0) continue;
    const s = byStatus.get(r.status) ?? { lines: 0, qty: 0 };
    s.lines += 1;
    s.qty += r.counted;
    byStatus.set(r.status, s);
  }
  const TONE: Record<ExpiryStatus, string> = {
    expired: 'text-mismatch',
    d15: 'text-mismatch',
    d40: 'text-review',
    ok: 'text-match',
    unknown: 'text-ink-faint',
  };

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/manage/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">სხვაობები</h1>
          <a
            href={`/count/${id}/report/excel`}
            className="rounded-control border border-rule-strong px-3 py-2 text-sm font-semibold"
          >
            ⬇ Excel
          </a>
        </div>
        {book.length === 0 && (
          <p className="mt-2 text-sm text-review">
            ნაშთი არ არის ჩატვირთული —{' '}
            <Link className="underline" href={`/count/${id}/book`}>
              ჩატვირთე
            </Link>
            .
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <div className="rounded-control border border-rule/70 p-3">
          <p className="text-2xl font-semibold text-match">{ok}</p>ემთხვევა
        </div>
        <div className="rounded-control border border-rule/70 p-3">
          <p className="text-2xl font-semibold text-mismatch">{diffs.length}</p>სხვაობა
        </div>
        <div className="rounded-control border border-rule/70 p-3">
          <p className="text-2xl font-semibold text-review">{missed.length}</p>გამორჩენილი
        </div>
        <div className="rounded-control border border-rule/70 p-3">
          <p className="text-2xl font-semibold">{checks.length}</p>გადათვლილი
        </div>
      </div>
      {isExpiry && batchRows.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-semibold">
            ⏳ ვადები (დათვლის დღეს: {fmtDate(stocktake.count_date)})
          </h2>
          <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
            {(['expired', 'd15', 'd40', 'ok', 'unknown'] as ExpiryStatus[]).map((k) => (
              <div key={k} className="rounded-control border border-rule/70 p-2">
                <p className={`text-xl font-semibold ${TONE[k]}`}>
                  {fmt(byStatus.get(k)?.qty ?? 0)}
                </p>
                <p>{EXPIRY_LABEL[k]}</p>
                <p className="text-xs text-ink-faint">{byStatus.get(k)?.lines ?? 0} პარტია</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr>
                  <th className="py-1 pr-2">პროდუქტი</th>
                  <th className="px-2">ვადა</th>
                  <th className="px-2 text-right">ნაშთი</th>
                  <th className="px-2 text-right">დათვლა</th>
                  <th className="pl-2">სტატუსი</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((r) => (
                  <tr
                    key={`${r.pid}|${r.expiry}`}
                    className={`border-t border-rule/60 ${r.status === 'expired' ? 'bg-mismatch/10' : ''}`}
                  >
                    <td className="py-1.5 pr-2">
                      {r.name}
                      <span className="block text-xs text-ink-faint">{r.sku}</span>
                    </td>
                    <td className="px-2 tabular-nums">{fmtDate(r.expiry)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(r.book)}</td>
                    <td
                      className={`px-2 text-right font-semibold tabular-nums ${r.counted !== r.book ? 'text-mismatch' : ''}`}
                    >
                      {fmt(r.counted)}
                    </td>
                    <td className={`pl-2 font-semibold ${TONE[r.status]}`}>
                      {EXPIRY_LABEL[r.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {value !== 0 && (
        <p className="text-sm">
          სხვაობა თანხით:{' '}
          <b className={value < 0 ? 'text-mismatch' : 'text-match'}>{money(value)}</b>
        </p>
      )}

      {regradeRows.length > 0 && (
        <section className="grid gap-2 rounded-control border border-rule/70 p-4">
          <h2 className="font-semibold">⇄ გადარევა — მეტობა და დანაკლისი ჯგუფებით</h2>
          <p className="text-xs text-ink-faint">
            ერთ ჯგუფში ერთი პროდუქტის მეტობა შეიძლება მეორის დანაკლისს ფარავდეს (აურიეს მიღებისას ან
            გაყიდვისას). „დაფარული“ = ნაკლები ორ თანხას შორის.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr>
                  <th className="py-1 pr-2">ჯგუფი</th>
                  <th className="px-2 text-right">მეტობა</th>
                  <th className="px-2 text-right">დანაკლისი</th>
                  <th className="px-2 text-right">დაფარული</th>
                  <th className="pl-2 text-right">დარჩენილი</th>
                </tr>
              </thead>
              <tbody>
                {regradeRows.map(([g, x]) => {
                  const left = x.plus - x.minus;
                  return (
                    <tr key={g} className="border-t border-rule/60 align-top">
                      <td className="py-1.5 pr-2">
                        <b>{g}</b>
                        <span className="block text-xs text-ink-faint">
                          {x.items
                            .map((r) => `${r.name} ${r.diff > 0 ? '+' : ''}${fmt(r.diff)}`)
                            .join(' · ')}
                        </span>
                      </td>
                      <td className="px-2 text-right tabular-nums text-match">
                        {money(x.plus)}
                        <span className="block text-xs text-ink-faint">{fmt(x.plusQ)} ერთ.</span>
                      </td>
                      <td className="px-2 text-right tabular-nums text-mismatch">
                        {money(x.minus)}
                        <span className="block text-xs text-ink-faint">{fmt(x.minusQ)} ერთ.</span>
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {money(Math.min(x.plus, x.minus))}
                      </td>
                      <td
                        className={`pl-2 text-right font-semibold tabular-nums ${left < 0 ? 'text-mismatch' : 'text-match'}`}
                      >
                        {left > 0 ? '+' : ''}
                        {money(left)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="font-semibold">
                <tr className="border-t-2 border-rule-strong">
                  <td className="py-1.5 pr-2">სულ</td>
                  <td className="px-2 text-right tabular-nums text-match">
                    {money(regradeAll.plus)}
                  </td>
                  <td className="px-2 text-right tabular-nums text-mismatch">
                    {money(regradeAll.minus)}
                  </td>
                  <td className="px-2 text-right tabular-nums">{money(regradeAll.off)}</td>
                  <td
                    className={`pl-2 text-right tabular-nums ${regradeAll.plus - regradeAll.minus < 0 ? 'text-mismatch' : 'text-match'}`}
                  >
                    {money(regradeAll.plus - regradeAll.minus)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {checks.length > 0 && (
        <section className="grid gap-2 rounded-control border-2 border-mismatch/50 p-4">
          <h2 className="font-semibold">🔒 გადათვლის შემდეგაც განსხვავდება</h2>
          <ul className="grid gap-1 text-sm">
            {checks.map((c) => (
              <li
                key={`${c.product_id}-${c.location_id}`}
                className="flex justify-between border-t border-rule/60 py-1.5"
              >
                <span>{names.get(c.product_id)?.name}</span>
                <span className="text-ink-faint">{locs.get(c.location_id)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diffs.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-mismatch">⚠ სხვაობები</h2>
          <Table items={diffs} tone="text-mismatch" />
        </section>
      )}
      {missed.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-review">გამორჩენილი — ნაშთშია, არავის დაუთვლია</h2>
          <Table items={missed} tone="text-review" />
        </section>
      )}
      {moved.size > 0 && (
        <section className="grid gap-2 rounded-control border-2 border-review/60 p-4">
          <h2 className="font-semibold">↔ სხვა თაროზე ნაპოვნი — გადასატანი</h2>
          <ul className="grid gap-1 text-sm">
            {[...moved.values()].map((m) => (
              <li
                key={`${m.pid}|${m.loc}`}
                className="flex justify-between gap-2 border-t border-rule/60 py-1.5"
              >
                <span>
                  {names.get(m.pid)?.name} <b>{fmt(m.qty)}</b>
                </span>
                <span className="text-ink-soft">
                  {locs.get(m.loc)} →{' '}
                  <b>{[...(booked.get(m.pid) ?? [])].map((l) => locs.get(l)).join(', ')}</b>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(fresh ?? []).length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold">🆕 ახალი პროდუქტები (სიაში არ იყო)</h2>
          <ul className="grid gap-2">
            {(fresh ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 border-t border-rule/60 pt-2 text-sm"
              >
                {thumbs.get(p.id) ? (
                  <a href={thumbs.get(p.id)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbs.get(p.id)}
                      alt=""
                      className="h-16 w-16 rounded-control object-cover"
                    />
                  </a>
                ) : (
                  <span className="h-16 w-16 rounded-control bg-paper-sunk" />
                )}
                <span className="flex-1">
                  <b>{p.name}</b>
                  <span className="block text-xs text-ink-faint">
                    {p.barcode ?? p.sku} · {locs.get(shelfOf.get(p.id) ?? '') ?? ''}
                  </span>
                </span>
                <b className="tabular-nums">{fmt(rows.get(p.id)?.counted ?? 0)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {extra.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold">დათვლილია, ნაშთში არ არის</h2>
          <Table items={extra} tone="text-ink" />
        </section>
      )}
      {(zones ?? []).length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold">თაროები და მთვლელები</h2>
          <ul className="grid gap-1 text-sm">
            {(zones ?? []).map((z) => (
              <li key={z.id} className="border-t border-rule/60 py-1.5">
                <div className="flex justify-between gap-2">
                  <span>
                    <b>{z.locations?.code}</b> ·{' '}
                    {z.user_profiles?.full_name ?? z.user_profiles?.email}
                  </span>
                  <span className={z.status === 'done' ? 'text-match' : 'text-review'}>
                    {z.status === 'done'
                      ? `✓ ${new Date(z.done_at ?? z.started_at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })}`
                      : 'ითვლება'}
                  </span>
                </div>
                {z.note && <p className="text-ink-soft">💬 {z.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unknown.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold">❓ უცნობი პროდუქტები</h2>
          <ul className="text-sm">
            {unknown.map((u, i) => (
              <li key={i} className="border-t border-rule/60 py-1.5">
                {u.unknown_label} — {fmt(u.quantity)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
