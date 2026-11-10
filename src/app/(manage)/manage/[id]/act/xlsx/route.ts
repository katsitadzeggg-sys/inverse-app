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
    'არტიკული',
    'ნომენკლატურა',
    'ძირითადი შტრიხკოდი',
    'ერთ.',
    'აღრიცხვით',
    'სხვაობა (რაოდ.)',
    'ფაქტ. რაოდენობა',
    ...(hasCost ? ['ფასი', 'სხვაობის თანხა'] : []),
    'კომენტარები',
  ];
  const num = (v: number, format = '0.0000') => ({ type: Number, value: v, format });
  const txt = (v: string) => ({ type: String, value: v });
  const data = [
    headers.map(head),
    ...lines.map((l) => [
      num(l.n, '0'),
      txt(l.sku),
      txt(l.name),
      txt(l.barcode),
      txt(l.unit),
      num(l.book),
      num(l.diff),
      num(l.counted),
      ...(hasCost
        ? [
            l.cost != null ? num(l.cost, '0.00') : null,
            l.cost != null && l.diff ? num(l.diff * l.cost, '0.00') : null,
          ]
        : []),
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
      { width: 16 },
      { width: 7 },
      { width: 12 },
      { width: 14 },
      { width: 15 },
      ...(hasCost ? [{ width: 10 }, { width: 14 }] : []),
      { width: 30 },
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
