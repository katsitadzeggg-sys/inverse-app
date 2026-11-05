import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import PrintButton from './print-button';
import ZebraPanel from './zebra-panel';

/**
 * Printable QR labels for fixed assets. The QR holds the inventory number, so
 * at the next count the label is a scan. By default: assets marked "label
 * missing" during the count; ?all=1 prints the whole register.
 */
export default async function LabelsPage({ params, searchParams }: PageProps<'/count/[id]/labels'>) {
  const { id } = await params;
  const all = (await searchParams).all === '1';
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: st } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!st) notFound();

  const items: { inv: string; name: string }[] = [];
  if (all) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('asset_register').select('inv_no, name').eq('stocktake_id', id).order('inv_no').range(from, from + 999);
      items.push(...(data ?? []).map((r) => ({ inv: r.inv_no, name: r.name })));
      if (!data || data.length < 1000) break;
    }
  } else {
    const { data } = await supabase.from('asset_checks').select('inv_no, name').eq('stocktake_id', id).eq('needs_label', true).order('inv_no');
    items.push(...(data ?? []).map((r) => ({ inv: r.inv_no, name: r.name })));
  }
  const labels = await Promise.all(
    items.slice(0, 2000).map(async (i) => ({ ...i, svg: await QRCode.toString(i.inv, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) })),
  );
  const owner = st.client_name ?? st.name;

  return (
    <div className="grid gap-4">
      <style>{`@media print { header, nav, .no-print { display: none !important; } main { padding: 0 !important; max-width: none !important; } @page { margin: 8mm; } }`}</style>
      <div className="no-print grid gap-2">
        <Link href={`/manage/${id}`} className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink">← დაბრუნება</Link>
        <h1 className="text-xl font-semibold">QR ეტიკეტები</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/count/${id}/labels`} className={`rounded-control border px-3 py-2 ${!all ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}>
            ეტიკეტი აკლია
          </Link>
          <Link href={`/count/${id}/labels?all=1`} className={`rounded-control border px-3 py-2 ${all ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}>
            მთელი რეესტრი
          </Link>
        </div>
        <p className="text-sm text-ink-soft">
          {labels.length ? `${labels.length} ეტიკეტი. დაბეჭდე სტიკერზე ან ქაღალდზე, დააწებე ნივთს — შემდეგ დათვლაზე უბრალოდ დაასკანერებ.` : 'დასაბეჭდი ეტიკეტი არ არის.'}
        </p>
        {labels.length > 0 && <PrintButton />}
      </div>
      {labels.length > 0 && <ZebraPanel items={items.slice(0, 2000).map((i) => ({ code: i.inv, title: i.name, footer: owner }))} fileName={st.number} />}
      <div className="grid grid-cols-3 gap-[3mm] print:grid-cols-3">
        {labels.map((l) => (
          <div key={l.inv} className="flex items-center gap-2 rounded border border-black/40 bg-white p-2 text-black" style={{ breakInside: 'avoid' }}>
            <div className="h-[22mm] w-[22mm] shrink-0 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="min-w-0 text-[9pt] leading-tight">
              <p className="font-bold">{l.inv}</p>
              <p className="line-clamp-2">{l.name}</p>
              <p className="mt-1 text-[7pt] text-black/60">{owner}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
