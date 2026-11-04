import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';

type Entry = {
  location_id: string;
  product_id: string | null;
  unknown_label: string | null;
  quantity: number;
  recounted: boolean;
  counter_id: string | null;
  created_at: string;
  products: { name: string; sku: string; barcode: string | null; unit: string } | null;
};

/**
 * The stocktake as an Excel file: number, date, company, warehouse/branch,
 * shelf, product, barcode, quantity, unit, who counted, whether it was
 * recounted, and the shelf note. ?shelf=<location id> for one shelf, or all.
 */
export async function GET(request: Request, { params }: RouteContext<'/count/[id]/export'>) {
  const { id } = await params;
  await requireSession();
  const shelf = new URL(request.url).searchParams.get('shelf') ?? 'all';
  const supabase = await createClient();

  const { data: st } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!st) return new NextResponse('Not found', { status: 404 });

  const entries: Entry[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from('stocktake_entries')
      .select('location_id, product_id, unknown_label, quantity, recounted, counter_id, created_at, products (name, sku, barcode, unit)')
      .eq('stocktake_id', id)
      .order('created_at')
      .range(from, from + 999);
    if (shelf !== 'all') q = q.eq('location_id', shelf);
    const { data } = await q.returns<Entry[]>();
    entries.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const [{ data: zones }, { data: checks }, { data: people }] = await Promise.all([
    supabase.from('stocktake_zones').select('location_id, note, counter_id, locations (code)').eq('stocktake_id', id)
      .returns<{ location_id: string; note: string | null; counter_id: string | null; locations: { code: string } | null }[]>(),
    supabase.from('stocktake_checks').select('location_id, product_id, attempts, status').eq('stocktake_id', id)
      .returns<{ location_id: string; product_id: string; attempts: number; status: string }[]>(),
    supabase.from('user_profiles').select('id, full_name, email').returns<{ id: string; full_name: string | null; email: string }[]>(),
  ]);
  const zoneBy = new Map((zones ?? []).map((z) => [z.location_id, z]));
  const checkBy = new Map((checks ?? []).map((c) => [`${c.location_id}|${c.product_id}`, c]));
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  const head = ['ინვენტარიზაცია №', 'თარიღი', 'კომპანია', 'საწყობი / ფილიალი', 'თარო', 'დასახელება', 'შტრიხკოდი', 'რაოდენობა', 'ერთეული', 'ავტორი', 'გადათვლილი', 'სტატუსი', 'კომენტარი თაროზე'];
  const header = head.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#1D2939', color: '#FFFFFF' }));

  const rows = entries.map((e) => {
    const z = zoneBy.get(e.location_id);
    const c = e.product_id ? checkBy.get(`${e.location_id}|${e.product_id}`) : undefined;
    const recount = e.recounted || (c?.attempts ?? 0) > 0;
    const unit = e.products?.unit === 'pcs' || !e.products ? 'ცალი' : e.products.unit;
    const status = c?.status === 'frozen' ? 'გადასამოწმებელი' : c?.status === 'ok' ? 'ზუსტი' : c?.status === 'recount' ? 'სხვაობა' : '';
    const color = recount ? '#FEF0C7' : undefined; // recounted lines stand out in yellow
    return [
      st.number,
      new Date(st.count_date).toLocaleDateString('ka-GE'),
      st.client_name ?? st.name,
      st.branch ?? '',
      z?.locations?.code ?? '',
      e.products?.name ?? `❓ ${e.unknown_label ?? ''}`,
      e.products?.barcode ?? e.products?.sku ?? '',
      Number(e.quantity),
      unit,
      who.get(e.counter_id ?? '') ?? '',
      recount ? `კი${c?.attempts ? ` (${c.attempts})` : ''}` : '',
      status,
      z?.note ?? '',
    ].map((value) => ({ value, type: typeof value === 'number' ? Number : String, backgroundColor: color }));
  });

  const buffer = await writeXlsxFile([header, ...rows], {
    buffer: true,
    sheet: 'დათვლა',
    columns: [{ width: 16 }, { width: 11 }, { width: 18 }, { width: 22 }, { width: 8 }, { width: 34 }, { width: 16 }, { width: 11 }, { width: 8 }, { width: 20 }, { width: 12 }, { width: 16 }, { width: 30 }],
  });

  const shelfCode = shelf === 'all' ? 'ყველა' : (zoneBy.get(shelf)?.locations?.code ?? 'თარო');
  const name = `${st.number}_${shelfCode}.xlsx`;
  return new NextResponse(new Uint8Array(buffer as Buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${st.number}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
