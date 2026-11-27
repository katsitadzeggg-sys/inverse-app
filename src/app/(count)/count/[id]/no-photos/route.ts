import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

type Line = {
  book_qty: number;
  locations: { code: string } | null;
  products: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    image_url: string | null;
  } | null;
};

/**
 * Products of this stocktake's balance that have no photo yet, as Excel:
 * name, barcode, code, balance and shelves — to find photos for them.
 * Row-level security keeps it to the caller's company.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('number, branch, name')
    .eq('id', id)
    .maybeSingle<{ number: string; branch: string | null; name: string }>();
  if (!st) return new NextResponse('Not found', { status: 404 });

  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('stocktake_book')
      .select('book_qty, locations (code), products (id, name, sku, barcode, image_url)')
      .eq('stocktake_id', id)
      .range(from, from + 999)
      .returns<Line[]>();
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const by = new Map<
    string,
    { p: NonNullable<Line['products']>; qty: number; shelves: Set<string> }
  >();
  for (const l of lines) {
    const p = l.products;
    if (!p || p.image_url) continue;
    const r = by.get(p.id) ?? { p, qty: 0, shelves: new Set<string>() };
    r.qty += Number(l.book_qty);
    if (l.locations?.code) r.shelves.add(l.locations.code);
    by.set(p.id, r);
  }
  const rows = [...by.values()].sort((a, b) => a.p.name.localeCompare(b.p.name, 'ka'));

  const head = ['დასახელება', 'შტრიხკოდი', 'კოდი', 'ნაშთი', 'თარო'].map((value) => ({
    value,
    fontWeight: 'bold' as const,
  }));
  const data = [
    head,
    ...rows.map((r) => [
      { value: r.p.name },
      { value: r.p.barcode ?? '' },
      { value: r.p.sku },
      { value: r.qty, type: Number },
      { value: [...r.shelves].sort().join(', ') },
    ]),
  ];
  const buffer = await writeXlsxFile(data as never, {
    buffer: true,
    sheet: 'ფოტოს გარეშე',
    columns: [{ width: 50 }, { width: 16 }, { width: 16 }, { width: 8 }, { width: 20 }],
  });
  const name = `${st.number}_ფოტოს_გარეშე.xlsx`;
  return new NextResponse(new Uint8Array(buffer as unknown as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${st.number}-no-photo.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
