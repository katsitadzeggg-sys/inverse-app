import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import AddDrawer from '@/components/add-drawer';
import SiteForms from './site-forms';
import SitesGrid, { type SiteRow } from './sites-grid';

export const metadata = { title: 'ობიექტები' };

/**
 * The company's warehouses and objects in a table (counters pick from this
 * list when they open a stocktake); "+" adds one in a drawer. Staff have their own page, /manage/team.
 */
export default async function SitesPage({ searchParams }: PageProps<'/manage/sites'>) {
  await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: sts }] = await Promise.all([
    supabase
      .from('sites')
      .select('id, name, address, lat, lng, model_url')
      .order('name')
      .returns<Omit<SiteRow, 'map_id'>[]>(),
    supabase
      .from('stocktakes')
      .select('id, branch, client_name, name')
      .neq('kind', 'assets')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  // The latest stocktake of each warehouse: its 3D map shows the whole warehouse.
  const latest = new Map<string, string>();
  for (const s of sts ?? []) {
    const key = s.branch || s.client_name || s.name;
    if (key && !latest.has(key)) latest.set(key, s.id);
  }
  const list: SiteRow[] = (data ?? []).map((s) => ({ ...s, map_id: latest.get(s.name) ?? null }));
  return (
    <div className="grid gap-4 rounded-2xl bg-paper-sunk p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">საწყობები და ობიექტები</h1>
        <div className="ml-auto">
          <AddDrawer title="საწყობი / ობიექტი" label="ახალი" startOpen={sp.add === '1'}>
            <SiteForms />
          </AddDrawer>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">ჯერ ცარიელია. „+ ახალი“-თი დაამატე.</p>
      ) : (
        <SitesGrid rows={list} />
      )}
    </div>
  );
}
