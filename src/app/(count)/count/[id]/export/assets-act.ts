import writeXlsxFile from 'write-excel-file/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Stocktake } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { ASSET_STATUS, CONDITION, loadAssetResult, type AssetStatus } from '@/lib/assets-result';

/**
 * Printable fixed-asset act: header block, one bordered table of the register
 * against what was found (missing first, then moved, surplus, found), a summary
 * and signature lines. ?shelf=<room id> limits it to one room.
 */
export async function assetsAct(supabase: SupabaseClient, st: Stocktake, shelf: string, origin: string): Promise<Buffer> {
  let rows = await loadAssetResult(supabase, st.id);
  let roomCode = '';
  if (shelf !== 'all') {
    const { data } = await supabase.from('locations').select('code').eq('id', shelf).maybeSingle<{ code: string }>();
    roomCode = data?.code ?? '';
    const u = roomCode.toUpperCase();
    rows = rows.filter((r) => (r.actualRoom ?? '').toUpperCase() === u || (r.registerRoom ?? '').toUpperCase() === u);
  }
  const order: AssetStatus[] = ['missing', 'moved', 'surplus', 'found'];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.invNo.localeCompare(b.invNo));
  const counters = [...new Set(rows.map((r) => r.counter).filter(Boolean))] as string[];

  type Cell = { value?: string | number; type?: typeof String | typeof Number; [k: string]: unknown } | null;
  const COLS = 7;
  const border = { borderColor: '#98A2B3', borderStyle: 'thin' };
  const txt = (value: string | number, extra: Record<string, unknown> = {}): Cell => ({ value, type: typeof value === 'number' ? Number : String, fontSize: 10, ...extra });
  const line = (label: string, value: string, extra: Record<string, unknown> = {}): Cell[] => [
    txt(label, { fontWeight: 'bold', span: 2, wrap: true, alignVertical: 'top' }),
    null,
    txt(value, { span: COLS - 2, wrap: true, height: Math.max(1, Math.ceil(value.length / 52), label.length > 12 ? 2 : 1) * 14, ...extra }),
    ...Array(COLS - 3).fill(null),
  ];
  const blank = (): Cell[] => Array(COLS).fill(null);
  const full = (value: string, extra: Record<string, unknown> = {}): Cell[] => [
    txt(value, { span: COLS, wrap: true, height: Math.max(1, Math.ceil(value.length / 75)) * 14, ...extra }),
    ...Array(COLS - 1).fill(null),
  ];
  const FILL: Record<AssetStatus, Record<string, string>> = {
    missing: { backgroundColor: '#FEE4E2' },
    moved: { backgroundColor: '#FEF0C7' },
    surplus: { backgroundColor: '#F4EBFF' },
    found: {},
  };

  const data: Cell[][] = [
    full(`ძირითადი საშუალებების ინვენტარიზაციის აქტი № ${st.number}`, { fontWeight: 'bold', fontSize: 14, align: 'center', height: 24 }),
    blank(),
    line('კომპანია', st.client_name ?? st.name),
    line('ობიექტი / ფილიალი', st.branch ?? ''),
    line('აღწერა ჩაატარა', counters.join(', ')),
    line('მისამართი', st.address ?? ''),
    line('ლოკაცია', st.lat != null && st.lng != null ? mapsLink(st.lat, st.lng) : ''),
    line('თარიღი', new Date(st.count_date).toLocaleDateString('ka-GE')),
    line('ოთახი', shelf === 'all' ? 'ყველა' : roomCode),
    blank(),
    ['№', 'ინვ. №', 'დასახელება', 'რეესტრით', 'ფაქტობრივად', 'მდგომარეობა', 'სტატუსი'].map((v) =>
      txt(v, { fontWeight: 'bold', backgroundColor: '#E4E7EC', align: 'center', wrap: true, height: 30, ...border }),
    ),
  ];
  rows.forEach((r, i) => {
    const f = FILL[r.status];
    const desc = r.name + (r.serial ? ` (S/N ${r.serial})` : '') + (r.note ? ` — ${r.note}` : '');
    const statusText = ASSET_STATUS[r.status] + (r.needsLabel ? ', ეტიკეტი' : '');
    // Wrapped text needs a taller row (write-excel-file does not size rows).
    const h = Math.max(1, Math.ceil(desc.length / 20), Math.ceil(statusText.length / 12), r.condition === 'damaged' ? 2 : 1) * 13;
    data.push([
      txt(i + 1, { align: 'center', ...border, ...f }),
      txt(r.invNo, { ...border, ...f }),
      txt(desc, { wrap: true, height: h, ...border, ...f }),
      txt(r.registerRoom ?? '', { ...border, ...f }),
      txt(r.actualRoom ?? '', { ...border, ...f }),
      txt(r.condition ? CONDITION[r.condition] : '', { wrap: true, ...border, ...f }),
      txt(statusText, { wrap: true, ...border, ...f, ...(r.status === 'missing' ? { fontWeight: 'bold' } : {}) }),
    ]);
  });

  const count = (s: AssetStatus) => rows.filter((r) => r.status === s).length;
  const missingValue = rows.filter((r) => r.status === 'missing').reduce((s, r) => s + (r.value ?? 0), 0);
  data.push(
    blank(),
    full('შეჯამება', { fontWeight: 'bold' }),
    line('ნაპოვნი', String(count('found'))),
    line('გადაადგილებული', String(count('moved'))),
    line('დაკარგული', `${count('missing')}${missingValue ? ` (ღირებულება ${missingValue.toFixed(2)} ლარი)` : ''}`),
    line('ზედმეტი', String(count('surplus'))),
    line('დაზიანებული / ჩამოსაწერი', `${rows.filter((r) => r.condition === 'damaged').length} / ${rows.filter((r) => r.condition === 'writeoff').length}`),
    full(`ფოტო და ვიდეო მასალა: ${origin}/manage/${st.id}`, { fontSize: 9, color: '#475467' }),
    blank(),
    blank(),
    line('აღწერა ჩაატარა', `${counters.join(', ')}   ხელმოწერა: ________________`),
    blank(),
    line('მატ. პასუხისმგებელი', 'სახელი გვარი: ________________   ხელმოწერა: ________________'),
  );

  return (await writeXlsxFile(data as never, {
    buffer: true,
    sheet: 'აქტი',
    columns: [{ width: 4 }, { width: 10 }, { width: 19 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 13 }],
  })) as Buffer;
}
