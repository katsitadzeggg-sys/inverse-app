import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

type Line = {
  qty: number;
  unit_cost: number | null;
  expiry_date: string | null;
  locations: { code: string } | null;
  products: { name: string; sku: string; barcode: string | null } | null;
};

/**
 * One version of a stocktake's balance as Excel: the version in use from the
 * balance itself, earlier and cancelled ones from the kept log. Row-level
 * security keeps it to the caller's company.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; v: string }> },
) {
  const { id, v } = await params;
  await requireSession();
  const supabase = await createClient();
  const { data: ver } = await supabase
    .from('stocktake_book_versions')
    .select('status, loaded_at, stocktakes (number)')
    .eq('id', v)
    .eq('stocktake_id', id)
    .maybeSingle<{ status: string; loaded_at: string; stocktakes: { number: string } | null }>();
  if (!ver) return new NextResponse('Not found', { status: 404 });

  const active = ver.status === 'active';
  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    const q = active
      ? supabase
          .from('stocktake_book')
          .select(
            'qty:book_qty, unit_cost, expiry_date, locations (code), products (name, sku, barcode)',
          )
          .eq('stocktake_id', id)
      : supabase
          .from('stocktake_book_log')
          .select('qty, unit_cost, expiry_date, locations (code), products (name, sku, barcode)')
          .eq('version_id', v);
    const { data } = await q.range(from, from + 999).returns<Line[]>();
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  lines.sort((a, b) => (a.products?.name ?? '').localeCompare(b.products?.name ?? '', 'ka'));

  const head = ['დასახელება', 'შტრიხკოდი', 'კოდი', 'ნაშთი', 'თარო', 'ფასი', 'ვადა'].map(
    (value) => ({ value, fontWeight: 'bold' as const }),
  );
  const rows = lines.map((l) => [
    { value: l.products?.name ?? '' },
    { value: l.products?.barcode ?? '' },
    { value: l.products?.sku ?? '' },
    { value: Number(l.qty), type: Number },
    { value: l.locations?.code ?? '' },
    l.unit_cost != null ? { value: Number(l.unit_cost), type: Number } : null,
    { value: l.expiry_date ?? '' },
  ]);
  const buf = await writeXlsxFile([head, ...rows] as never, {
    buffer: true,
    sheet: 'ნაშთი',
    columns: [
      { width: 50 },
      { width: 16 },
      { width: 16 },
      { width: 8 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
    ],
  });
  const day = new Date(ver.loaded_at).toISOString().slice(0, 10);
  const name = `nashti-${ver.stocktakes?.number ?? id}-${day}.xlsx`;
  return new NextResponse(new Uint8Array(buf as unknown as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
