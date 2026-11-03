import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Card, EmptyState } from '@/components/ui';
import type { Location } from '@/types/database';
import NewLocationForm from './new-location-form';

export const metadata = { title: 'Locations' };

type LevelRow = { location_id: string; quantity: number };

export default async function LocationsPage() {
  const { canWrite } = await requireSession();
  const supabase = await createClient();

  const [{ data: locations }, { data: levels }] = await Promise.all([
    supabase.from('locations').select('*').order('code').returns<Location[]>(),
    supabase
      .from('inventory_levels')
      .select('location_id, quantity')
      .returns<LevelRow[]>(),
  ]);

  const stats = new Map<string, { skus: number; units: number }>();
  for (const level of levels ?? []) {
    const current = stats.get(level.location_id) ?? { skus: 0, units: 0 };
    current.skus += 1;
    current.units += level.quantity;
    stats.set(level.location_id, current);
  }

  const list = locations ?? [];
  const byId = new Map(list.map((location) => [location.id, location]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Warehouses, racks and shelves. A verification always runs against one location.
        </p>
      </div>

      {canWrite && <NewLocationForm locations={list} />}

      {list.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description="Add a warehouse, then the racks and shelves inside it. Shelf codes like R-2 are what you will pick from when running a verification."
        />
      ) : (
        <Card title="All locations">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-rule/70 text-left text-xs uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 pr-4 font-medium">Code</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Inside</th>
                  <th className="pb-2 pr-4 text-right font-medium">SKUs</th>
                  <th className="pb-2 text-right font-medium">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/50">
                {list.map((location) => {
                  const stat = stats.get(location.id);
                  const parent = location.parent_id
                    ? byId.get(location.parent_id)
                    : undefined;
                  return (
                    <tr key={location.id}>
                      <td className="py-3 pr-4 font-mono text-xs text-ink-soft">
                        {location.code}
                      </td>
                      <td className="py-3 pr-4 font-medium">{location.name}</td>
                      <td className="py-3 pr-4 capitalize text-ink-soft">{location.kind}</td>
                      <td className="py-3 pr-4 text-ink-faint">
                        {parent ? `${parent.code} — ${parent.name}` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {stat?.skus ?? 0}
                      </td>
                      <td className="py-3 text-right tabular-nums">{stat?.units ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
