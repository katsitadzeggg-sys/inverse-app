import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, EmptyState, ButtonLink } from '@/components/ui';
import type { Location, ProductStock } from '@/types/database';
import NewProductForm from './new-product-form';
import LocationFilter from './location-filter';
import StockCell from './stock-cell';

export const metadata = { title: 'Products' };

type LevelRow = {
  product_id: string;
  location_id: string;
  quantity: number;
};

export default async function ProductsPage({ searchParams }: PageProps<'/products'>) {
  const { canWrite } = await requireSession();
  const params = await searchParams;
  const locationFilter = typeof params.location === 'string' ? params.location : '';
  const query = (typeof params.q === 'string' ? params.q : '').trim();

  const supabase = await createClient();

  const [{ data: locations }, { data: levels }] = await Promise.all([
    supabase.from('locations').select('*').order('code').returns<Location[]>(),
    supabase
      .from('inventory_levels')
      .select('product_id, location_id, quantity')
      .returns<LevelRow[]>(),
  ]);

  let productQuery = supabase
    .from('product_stock')
    .select('*')
    .eq('active', true)
    .order('sku');

  if (query) {
    // Postgres `or` filter — matches SKU, name or brand.
    const escaped = query.replace(/[%,()]/g, '');
    productQuery = productQuery.or(
      `sku.ilike.%${escaped}%,name.ilike.%${escaped}%,brand.ilike.%${escaped}%`,
    );
  }

  const { data: allProducts } = await productQuery.returns<ProductStock[]>();

  const levelsByProduct = new Map<string, LevelRow[]>();
  for (const level of levels ?? []) {
    const rows = levelsByProduct.get(level.product_id) ?? [];
    rows.push(level);
    levelsByProduct.set(level.product_id, rows);
  }

  const products = (allProducts ?? []).filter((product) => {
    if (!locationFilter) return true;
    return (levelsByProduct.get(product.product_id) ?? []).some(
      (level) => level.location_id === locationFilter,
    );
  });

  const locationList = locations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {products.length} shown{locationFilter ? ' at this location' : ''}
          </p>
        </div>
        <LocationFilter locations={locationList} location={locationFilter} query={query} />
      </div>

      {canWrite && <NewProductForm locations={locationList} />}

      {products.length === 0 ? (
        <EmptyState
          title="No products match"
          description={
            query || locationFilter
              ? 'Try clearing the filters.'
              : 'Add your first product above, or load the demo catalogue from Settings.'
          }
          action={
            !query && !locationFilter ? (
              <ButtonLink href="/settings" variant="secondary">
                Go to Settings
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden" title="Catalogue">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-rule/70 text-left text-xs uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 pr-4 font-medium">SKU</th>
                  <th className="pb-2 pr-4 font-medium">Product</th>
                  <th className="pb-2 pr-4 font-medium">Category</th>
                  <th className="pb-2 pr-4 text-right font-medium">On hand</th>
                  <th className="pb-2 pr-4 text-right font-medium">Reorder at</th>
                  <th className="pb-2 font-medium">Stock by location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/50">
                {products.map((product) => (
                  <tr key={product.product_id} className="align-top">
                    <td className="py-3 pr-4 font-mono text-xs text-ink-soft">
                      {product.sku}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-medium">
                        {[product.brand, product.name].filter(Boolean).join(' ')}
                      </p>
                      {product.variant && (
                        <p className="text-xs text-ink-faint">{product.variant}</p>
                      )}
                      {product.barcode && (
                        <p className="font-mono text-xs text-ink-faint">
                          {product.barcode}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">
                      {product.category_name ?? '—'}
                    </td>
                    <td
                      className={`py-3 pr-4 text-right font-semibold tabular-nums ${
                        product.is_low_stock ? 'text-review' : 'text-ink'
                      }`}
                    >
                      {product.total_quantity} {product.unit}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink-faint">
                      {product.reorder_point}
                    </td>
                    <td className="py-3">
                      <StockCell
                        productId={product.product_id}
                        locations={locationList}
                        levels={levelsByProduct.get(product.product_id) ?? []}
                        canWrite={canWrite}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
