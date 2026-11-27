import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import LabelStudio from './label-studio';

export const metadata = { title: 'ეტიკეტები' };

/**
 * Labels for the whole company: numbered QR codes (A-001…A-200) in one run,
 * barcodes from a list, the company's shelves, or the shelves, products and
 * inventory numbers of one stocktake. Printing as before: label printer,
 * Bluetooth (Zebra) or sticker sheets on A4.
 */
export default async function LabelsPage() {
  const { company } = await requireSession();
  const supabase = await createClient();
  const shelves: { code: string; name: string }[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase
      .from('locations')
      .select('code, name')
      .eq('company_id', company.id)
      .eq('kind', 'shelf')
      .order('code')
      .range(from, from + 999);
    shelves.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  shelves.sort((a, b) => a.code.localeCompare(b.code, 'ka', { numeric: true }));
  const { data: open } = await supabase
    .from('stocktakes')
    .select('id, number, branch, name, kind')
    .eq('company_id', company.id)
    .eq('status', 'open')
    .is('archived_at', null)
    .is('form_kind', null)
    .order('created_at', { ascending: false });

  return (
    <LabelStudio
      owner={company.name}
      shelves={shelves}
      stocktakes={(open ?? []).map((s) => ({
        id: s.id as string,
        label: `${s.branch ?? s.name} · ${s.number}${s.kind === 'assets' ? ' · ძირ. საშ.' : ''}`,
      }))}
    />
  );
}
