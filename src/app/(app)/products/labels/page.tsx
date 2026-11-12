import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { LabelData } from '@/lib/zebra';
import ZebraPanel from '@/app/(count)/count/[id]/labels/zebra-panel';

export const metadata = { title: 'Product barcodes' };

/**
 * Barcode labels for the whole catalogue (active products), for the Zebra
 * printer. Same label studio as the stocktake labels, size picked on the page.
 */
export default async function ProductLabelsPage() {
  const { canWrite } = await requireSession();
  if (!canWrite) redirect('/products');
  const supabase = await createClient();
  const { data } = await supabase
    .from('product_stock')
    .select('sku, barcode, name, brand, variant')
    .eq('active', true)
    .order('sku')
    .limit(5000)
    .returns<{ sku: string; barcode: string | null; name: string; brand: string | null; variant: string | null }[]>();

  const items: LabelData[] = (data ?? []).map((p) => {
    const code = p.barcode || p.sku;
    const title = [p.brand, p.name, p.variant].filter(Boolean).join(' ');
    return { code, title, mode: 'barcode' as const };
  });

  return (
    <div className="grid gap-4">
      <Link href="/products" className="inline-flex w-fit text-sm underline">
        ← Products
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Product barcodes</h1>
      <p className="text-sm text-ink-soft">
        {items.length
          ? `${items.length} product. Barcode = the product's barcode, or its SKU if it has none.`
          : 'No active products.'}
      </p>
      {items.length > 0 && (
        <ZebraPanel items={items} fileName="products" kind="products" />
      )}
    </div>
  );
}
