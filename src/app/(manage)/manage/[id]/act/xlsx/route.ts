import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { stockActData } from '@/lib/stock-act';

/**
 * The stock act as a plain table in Balance's column order (first row =
 * headers, then one line per product), so it can be read into Balance's
 * inventory document or checked in Excel. ?only=diff — differences only.
 */
export async function GET(request: Request, { params }: RouteContext<'/manage/[id]/act/xlsx'>) {
  const { id } = await params;
  await requireSession();
  const onlyDiff = new URL(request.url).searchParams.get('only') === 'diff';
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) return new NextResponse('Not found', { status: 404 });

  const { lines: all, hasCost } = await stockActData(supabase, id);
  const lines = onlyDiff ? all.filter((l) => l.diff !== 0) : all;
  const head = (value: string) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: '#EEF1F5',
  });
  const headers = [
    'N',
    'სერიული ნომერი',
    'ნომენკლატურა',
    'ჯგუფი',
    'ძირითადი შტრიხკოდი',
    'ერთ.',
    ...(hasCost ? ['ფასი'] : []),
    'ბუღალტრული ნაშთი',
    'სხვაობა (რაოდ.)',
    'ფაქტ. რაოდენობა',
    ...(hasCost ? ['სხვაობის თანხა'] : []),
    'თარო',
    'ფოტო/ვიდეო',
    'კომენტარები',
  ];
  // Quantities as plain numbers (no Balance-style 0.0000).
  const num = (v: number, format?: string) => ({
    type: Number,
    value: v,
    ...(format ? { format } : {}),
  });
  const txt = (v: string) => ({ type: String, value: v });
  // A clickable link to the shelf page with its photos/videos (sign-in needed).
  const origin = new URL(request.url).origin;
  const mediaCell = (shelves: { id: string; code: string; media: number }[]) => {
    const withMedia = shelves.filter((s) => s.media > 0);
    if (!withMedia.length) return null;
    const s = withMedia[0];
    const more = withMedia.length > 1 ? ` (+${withMedia.length - 1} თარო)` : '';
    return {
      type: 'Formula' as const,
      value: `HYPERLINK("${origin}/count/${id}/${s.id}/done","📷 ${s.code} · ${s.media}${more}")`,
      color: '#2B6CB0',
    };
  };
  const data = [
    headers.map(head),
    ...lines.map((l) => [
      num(l.n),
      txt(l.sku),
      txt(l.name),
      txt(l.group),
      txt(l.barcode),
      txt(l.unit),
      ...(hasCost ? [l.cost != null ? num(l.cost, '0.00') : null] : []),
      num(l.book),
      num(l.diff),
      num(l.counted),
      ...(hasCost ? [l.cost != null && l.diff ? num(l.diff * l.cost, '0.00') : null] : []),
      txt(l.shelves.map((s) => s.code).join(', ')),
      mediaCell(l.shelves),
      txt(l.comment),
    ]),
  ];
  const buffer = await writeXlsxFile(data as never, {
    buffer: true,
    sheet: 'ინვენტარიზაცია',
    columns: [
      { width: 5 },
      { width: 16 },
      { width: 40 },
      { width: 18 },
      { width: 16 },
      { width: 7 },
      ...(hasCost ? [{ width: 10 }] : []),
      { width: 14 },
      { width: 14 },
      { width: 15 },
      ...(hasCost ? [{ width: 14 }] : []),
      { width: 14 },
      { width: 22 },
      { width: 18 },
    ],
  });
  const name = `${st.number}_ინვენტარიზაცია${onlyDiff ? '_სხვაობები' : ''}.xlsx`;
  return new NextResponse(new Uint8Array(buffer as Buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${st.number}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
