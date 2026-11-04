import { NextResponse } from 'next/server';
import writeXlsxFile from 'write-excel-file/node';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { assetsAct } from './assets-act';
import { EXPIRY_LABEL, expiryStatus, fmtDate, type ExpiryStatus } from '@/lib/expiry';

type Entry = {
  location_id: string;
  product_id: string | null;
  unknown_label: string | null;
  quantity: number;
  recounted: boolean;
  counter_id: string | null;
  created_at: string;
  expiry_date: string | null;
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

  if (st.kind === 'assets') {
    const buffer = await assetsAct(supabase, st, shelf, new URL(request.url).origin);
    const name = `${st.number}_ძირითადი.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${st.number}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  }

  const entries: Entry[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from('stocktake_entries')
      .select('location_id, product_id, unknown_label, quantity, recounted, counter_id, created_at, expiry_date, products (name, sku, barcode, unit)')
      .eq('stocktake_id', id)
      .order('created_at')
      .range(from, from + 999);
    if (shelf !== 'all') q = q.eq('location_id', shelf);
    const { data } = await q.returns<Entry[]>();
    entries.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const [{ data: zones }, { data: checks }, { data: people }, { data: media }] = await Promise.all([
    supabase.from('stocktake_zones').select('location_id, note, counter_id, lat, lng, locations (code)').eq('stocktake_id', id)
      .returns<{ location_id: string; note: string | null; counter_id: string | null; lat: number | null; lng: number | null; locations: { code: string } | null }[]>(),
    supabase.from('stocktake_checks').select('location_id, product_id, attempts, status').eq('stocktake_id', id)
      .returns<{ location_id: string; product_id: string; attempts: number; status: string }[]>(),
    supabase.from('user_profiles').select('id, full_name, email').returns<{ id: string; full_name: string | null; email: string }[]>(),
    supabase.from('stocktake_media').select('location_id, kind').eq('stocktake_id', id).returns<{ location_id: string; kind: string }[]>(),
  ]);
  // Photos and videos per shelf: a count and a link to the shelf page in the app (sign-in needed).
  const origin = new URL(request.url).origin;
  const mediaBy = new Map<string, { photo: number; video: number }>();
  for (const m of media ?? []) {
    const c = mediaBy.get(m.location_id) ?? { photo: 0, video: 0 };
    if (m.kind === 'video') c.video += 1;
    else c.photo += 1;
    mediaBy.set(m.location_id, c);
  }
  const zoneBy = new Map((zones ?? []).map((z) => [z.location_id, z]));
  // Expiry-date act: lines grouped by expiry date, soonest first, unknown last.
  const isExpiry = st.kind === 'expiry';
  if (isExpiry) entries.sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'));
  const checkBy = new Map((checks ?? []).map((c) => [`${c.location_id}|${c.product_id}`, c]));
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  // A printable act: a header block with the stocktake details, the counted
  // lines as a bordered table, shelf notes, and signature lines.
  type Cell = { value?: string | number; type?: typeof String | typeof Number; [k: string]: unknown } | null;
  const COLS = 7;
  const border = { borderColor: '#98A2B3', borderStyle: 'thin' };
  const txt = (value: string | number, extra: Record<string, unknown> = {}): Cell => ({
    value,
    type: typeof value === 'number' ? Number : String,
    fontSize: 10,
    ...extra,
  });
  const line = (label: string, value: string, extra: Record<string, unknown> = {}): Cell[] => [
    txt(label, { fontWeight: 'bold', span: 2, wrap: true, alignVertical: 'top' }),
    null,
    txt(value, { span: COLS - 2, wrap: true, height: Math.max(1, Math.ceil(value.length / 52), label.length > 12 ? 2 : 1) * 14, ...extra }),
    ...Array(COLS - 3).fill(null),
  ];
  const blank = (): Cell[] => Array(COLS).fill(null);
  // Long text wraps; give the row room (about 85 characters a line).
  const full = (value: string, extra: Record<string, unknown> = {}): Cell[] => [
    txt(value, { span: COLS, wrap: true, height: Math.max(1, Math.ceil(value.length / 75)) * 14, ...extra }),
    ...Array(COLS - 1).fill(null),
  ];

  const shelfIds = shelf === 'all' ? [...new Set(entries.map((e) => e.location_id))] : [shelf];
  const counters = [...new Set(shelfIds.map((l) => who.get(zoneBy.get(l)?.counter_id ?? '') ?? '').filter(Boolean))];
  const shelfZone = shelf !== 'all' ? zoneBy.get(shelf) : undefined;
  const place =
    st.lat != null && st.lng != null
      ? mapsLink(st.lat, st.lng)
      : shelfZone?.lat != null && shelfZone?.lng != null
        ? mapsLink(shelfZone.lat, shelfZone.lng)
        : '';

  const data: Cell[][] = [
    full(`${isExpiry ? 'ვადიანი პროდუქციის ინვენტარიზაციის აქტი' : 'ინვენტარიზაციის აქტი'} № ${st.number}`, { fontWeight: 'bold', fontSize: 14, align: 'center', height: 24 }),
    blank(),
    line('კომპანია', st.client_name ?? st.name),
    line('საწყობი / ფილიალი', st.branch ?? ''),
    line('სახელი გვარი', counters.join(', ')),
    line('მისამართი', st.address ?? ''),
    line('ლოკაცია', place),
    line('თარიღი', new Date(st.count_date).toLocaleDateString('ka-GE')),
    line('თარო', shelf === 'all' ? `ყველა (${shelfIds.length})` : (shelfZone?.locations?.code ?? '')),
    blank(),
    ['№', 'თარო', 'დასახელება', 'შტრიხკოდი', 'რაოდ.', isExpiry ? 'ვადა' : 'ერთ.', isExpiry ? 'სტატუსი' : 'შენიშვნა'].map((v) =>
      txt(v, { fontWeight: 'bold', backgroundColor: '#E4E7EC', align: 'center', ...border }),
    ),
  ];

  entries.forEach((e, i) => {
    const z = zoneBy.get(e.location_id);
    const c = e.product_id ? checkBy.get(`${e.location_id}|${e.product_id}`) : undefined;
    const recount = e.recounted || (c?.attempts ?? 0) > 0;
    const unit = e.products?.unit === 'pcs' || !e.products ? 'ცალი' : e.products.unit;
    const status = c?.status === 'frozen' ? 'გადასამოწმებელი' : c?.status === 'ok' ? 'ზუსტი' : c?.status === 'recount' ? 'სხვაობა' : '';
    const exp = isExpiry ? expiryStatus(e.expiry_date, st.count_date) : null;
    // Expired lines in red, recounted lines in yellow.
    const fill = exp === 'expired' ? { backgroundColor: '#FEE4E2' } : recount ? { backgroundColor: '#FEF0C7' } : {};
    const note = c?.status === 'frozen' ? 'გადასამოწმებელი' : recount ? `გადათვლილი${c?.attempts ? ` (${c.attempts})` : ''}` : status;
    data.push([
      txt(i + 1, { align: 'center', ...border, ...fill }),
      txt(z?.locations?.code ?? '', { ...border, ...fill }),
      txt(e.products?.name ?? `❓ ${e.unknown_label ?? ''}`, { wrap: true, ...border, ...fill }),
      txt(e.products?.barcode ?? e.products?.sku ?? '', { ...border, ...fill }),
      txt(Number(e.quantity), { align: 'right', ...border, ...fill }),
      isExpiry ? txt(fmtDate(e.expiry_date), { align: 'center', ...border, ...fill }) : txt(unit, { align: 'center', ...border, ...fill }),
      txt(exp ? [EXPIRY_LABEL[exp], note].filter(Boolean).join(', ') : note, { wrap: true, ...border, ...fill, ...(exp === 'expired' || exp === 'd15' ? { fontWeight: 'bold' } : {}) }),
    ]);
  });

  data.push(blank(), full(`სულ პოზიცია: ${entries.length}. ყვითლად მონიშნული — გადათვლილი პოზიცია.${isExpiry ? ' წითლად — ვადაგასული.' : ''}`, { fontSize: 9, color: '#475467' }));
  if (isExpiry) {
    const sum = new Map<ExpiryStatus, { lines: number; qty: number }>();
    for (const e of entries) {
      const k = expiryStatus(e.expiry_date, st.count_date);
      const v = sum.get(k) ?? { lines: 0, qty: 0 };
      v.lines += 1;
      v.qty += Number(e.quantity);
      sum.set(k, v);
    }
    data.push(blank(), full(`ვადების შეჯამება (${fmtDate(st.count_date)}-ის მდგომარეობით)`, { fontWeight: 'bold' }));
    for (const k of ['expired', 'd15', 'd40', 'ok', 'unknown'] as ExpiryStatus[]) {
      const v = sum.get(k);
      if (v) data.push(line(EXPIRY_LABEL[k], `${v.lines} პოზიცია, ${v.qty} ერთეული`));
    }
  }

  const notes: string[] = [];
  for (const l of shelfIds) {
    const z = zoneBy.get(l);
    const m = mediaBy.get(l);
    const code = z?.locations?.code ?? '';
    if (z?.note) notes.push(`${code}: ${z.note}`);
    if (m) {
      const media = [m.photo ? `${m.photo} ფოტო` : '', m.video ? `${m.video} ვიდეო` : ''].filter(Boolean).join(', ');
      notes.push(`${code}: ${media} — ${origin}/count/${id}/${l}/done`);
    }
    if (z?.lat != null && z?.lng != null) notes.push(`${code}: აღწერის ადგილი — ${mapsLink(z.lat, z.lng)}`);
  }
  if (notes.length) {
    data.push(blank(), full('კომენტარები', { fontWeight: 'bold' }));
    for (const n of notes) data.push(full(n, { fontSize: 9 }));
  }

  data.push(
    blank(),
    blank(),
    line('აღწერა ჩაატარა', `${counters.join(', ')}   ხელმოწერა: ________________`),
    blank(),
    line('წარმომადგენელი', 'სახელი გვარი: ________________   ხელმოწერა: ________________'),
  );

  const buffer = await writeXlsxFile(data as never, {
    buffer: true,
    sheet: 'აქტი',
    columns: isExpiry
      ? [{ width: 4 }, { width: 8 }, { width: 20 }, { width: 13 }, { width: 6 }, { width: 10 }, { width: 14 }]
      : [{ width: 4 }, { width: 9 }, { width: 24 }, { width: 13 }, { width: 6 }, { width: 5 }, { width: 14 }],
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
