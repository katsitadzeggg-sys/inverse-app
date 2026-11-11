import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { requireSession } from '@/lib/session';

/** Empty warehouse list to fill in and load back: A — name, B — address. */
export async function GET() {
  await requireSession();
  const head = (value: string) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: '#EEF1F5',
  });
  const data = [
    [head('სახელი (საწყობი / ობიექტი)'), head('მისამართი')],
    [
      { type: String, value: 'ცენტრალური საწყობი' },
      { type: String, value: 'თბილისი, დავით აღმაშენებლის ხეივანი 240' },
    ],
  ];
  const buffer = await writeXlsxFile(data as never, {
    buffer: true,
    sheet: 'საწყობები',
    columns: [{ width: 34 }, { width: 50 }],
  });
  const name = 'საწყობების_შაბლონი.xlsx';
  return new NextResponse(new Uint8Array(buffer as Buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sites.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
