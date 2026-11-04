import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { EXPIRY_LABEL, expiryStatus, fmtDate } from '@/lib/expiry';

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Book against count as Excel, for the manager: every product (per batch in an
 * expiry-date count) with book, counted, difference, unit price and the
 * difference in money, plus a status. Differences first, by money.
 */
export async function GET(_request: Request, { params }: RouteContext<'/count/[id]/report/excel'>) {
  const { id } = await params;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return new NextResponse('Forbidden', { status: 403 });
  const supabase = await createClient();
  const { data: st } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!st) return new NextResponse('Not found', { status: 404 });
  const isExpiry = st.kind === 'expiry';

  const [book, entries] = await Promise.all([
    all<{ product_id: string; book_qty: number; unit_cost: number | null; expiry_date: string | null }>((a, b) =>
      supabase.from('stocktake_book').select('product_id, book_qty, unit_cost, expiry_date').eq('stocktake_id', id).range(a, b),
    ),
    all<{ product_id: string | null; unknown_label: string | null; quantity: number; expiry_date: string | null }>((a, b) =>
      supabase.from('stocktake_entries').select('product_id, unknown_label, quantity, expiry_date').eq('stocktake_id', id).range(a, b),
    ),
  ]);

  const key = (pid: string, exp: string | null) => (isExpiry ? `${pid}|${exp ?? ''}` : pid);
  const rows = new Map<string, { pid: string; expiry: string | null; book: number; counted: number; cost: number | null }>();
  for (const b of book) {
    const k = key(b.product_id, b.expiry_date);
    const r = rows.get(k) ?? { pid: b.product_id, expiry: isExpiry ? b.expiry_date : null, book: 0, counted: 0, cost: null };
    r.book += Number(b.book_qty);
    r.cost = b.unit_cost ?? r.cost;
    rows.set(k, r);
  }
  const unknown: { label: string; qty: number }[] = [];
  for (const e of entries) {
    if (!e.product_id) {
      unknown.push({ label: e.unknown_label ?? '', qty: Number(e.quantity) });
      continue;
    }
    const k = key(e.product_id, e.expiry_date);
    const r = rows.get(k) ?? { pid: e.product_id, expiry: isExpiry ? e.expiry_date : null, book: 0, counted: 0, cost: null };
    r.counted += Number(e.quantity);
    rows.set(k, r);
  }
  // The price of a product applies to all its batches.
  const priceOf = new Map<string, number>();
  for (const r of rows.values()) if (r.cost != null) priceOf.set(r.pid, r.cost);

  const ids = [...new Set([...rows.values()].map((r) => r.pid))];
  const names = new Map<string, { name: string; sku: string; barcode: string | null; unit: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('products').select('id, name, sku, barcode, unit').in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) names.set(p.id, p);
  }

  const list = [...rows.values()].map((r) => {
    const cost = r.cost ?? priceOf.get(r.pid) ?? null;
    const diff = r.counted - r.book;
    const status = r.book > 0 && r.counted === 0 ? 'გამორჩენილი' : r.book === 0 && r.counted > 0 ? 'ნაშთში არ არის' : diff === 0 ? 'ემთხვევა' : diff < 0 ? 'დანაკლისი' : 'ზედმეტობა';
    return { ...r, cost, diff, value: cost != null ? diff * cost : null, status, p: names.get(r.pid) };
  });
  list.sort((a, b) => Number(a.diff === 0) - Number(b.diff === 0) || Math.abs(b.value ?? b.diff) - Math.abs(a.value ?? a.diff));

  type Cell = { value?: string | number; type?: typeof String | typeof Number; [k: string]: unknown } | null;
  const border = { borderColor: '#98A2B3', borderStyle: 'thin' };
  const c = (value: string | number | null, extra: Record<string, unknown> = {}): Cell =>
    value == null || value === '' ? { ...border, ...extra } : { value, type: typeof value === 'number' ? Number : String, fontSize: 10, ...border, ...extra };
  const head = ['№', 'დასახელება', 'შტრიხკოდი', ...(isExpiry ? ['ვადა', 'ვადის სტატუსი'] : []), 'ერთ.', 'ნაშთი', 'დათვლა', 'სხვაობა', 'ფასი', 'სხვაობა ₾', 'სტატუსი'];
  const W = head.length;
  const title = (text: string, extra: Record<string, unknown> = {}): Cell[] => [{ value: text, type: String, span: W, fontSize: 12, fontWeight: 'bold', ...extra }, ...Array(W - 1).fill(null)];

  const data: Cell[][] = [
    title(`სხვაობების უწყისი № ${st.number}`, { fontSize: 14 }),
    title(`${st.client_name ?? st.name}${st.branch ? ` / ${st.branch}` : ''} · ${new Date(st.count_date).toLocaleDateString('ka-GE')}`, { fontWeight: 'normal', fontSize: 10 }),
    Array(W).fill(null),
    head.map((h) => c(h, { fontWeight: 'bold', backgroundColor: '#E4E7EC', align: 'center', wrap: true })),
  ];
  list.forEach((r, i) => {
    const fill = r.diff < 0 ? { backgroundColor: '#FEE4E2' } : r.diff > 0 ? { backgroundColor: '#FEF0C7' } : {};
    const exp = isExpiry ? expiryStatus(r.expiry, st.count_date) : null;
    data.push([
      c(i + 1, { align: 'center', ...fill }),
      c(r.p?.name ?? '', { wrap: true, ...fill }),
      c(r.p?.barcode ?? r.p?.sku ?? '', fill),
      ...(isExpiry ? [c(fmtDate(r.expiry), { align: 'center', ...fill }), c(exp ? EXPIRY_LABEL[exp] : '', fill)] : []),
      c(!r.p?.unit || r.p.unit === 'pcs' ? 'ცალი' : r.p.unit, { align: 'center', ...fill }),
      c(r.book, { align: 'right', ...fill }),
      c(r.counted, { align: 'right', ...fill }),
      c(r.diff, { align: 'right', fontWeight: r.diff ? 'bold' : undefined, ...fill }),
      c(r.cost, { align: 'right', format: '#,##0.00', ...fill }),
      c(r.value, { align: 'right', format: '#,##0.00', fontWeight: r.value ? 'bold' : undefined, ...fill }),
      c(r.status, fill),
    ]);
  });

  const sum = (f: (r: (typeof list)[number]) => number) => list.reduce((s, r) => s + f(r), 0);
  const shortage = sum((r) => (r.value != null && r.value < 0 ? r.value : 0));
  const surplus = sum((r) => (r.value != null && r.value > 0 ? r.value : 0));
  data.push(
    Array(W).fill(null),
    title(`დანაკლისი: ${shortage.toFixed(2)} ₾ · ზედმეტობა: ${surplus.toFixed(2)} ₾ · სალდო: ${(shortage + surplus).toFixed(2)} ₾`, { fontSize: 11 }),
    title(`პოზიცია: ${list.length}, აქედან სხვაობით ${list.filter((r) => r.diff !== 0).length}, ემთხვევა ${list.filter((r) => r.diff === 0).length}.`, { fontWeight: 'normal', fontSize: 10 }),
  );
  if (unknown.length) {
    data.push(Array(W).fill(null), title('უცნობი პროდუქტები (ამოსაცნობი)'));
    for (const u of unknown) data.push([c(u.label, { span: W - 1, wrap: true }), ...Array(W - 2).fill(null), c(u.qty, { align: 'right' })]);
  }

  const widths = isExpiry ? [4, 26, 14, 10, 12, 6, 8, 8, 8, 9, 11, 13] : [4, 30, 14, 6, 8, 8, 8, 9, 11, 13];
  const buffer = await writeXlsxFile(data as never, { buffer: true, sheet: 'სხვაობები', columns: widths.map((width) => ({ width })), stickyRowsCount: 4 });
  const name = `${st.number}_სხვაობები.xlsx`;
  return new NextResponse(new Uint8Array(buffer as Buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${st.number}-diff.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
