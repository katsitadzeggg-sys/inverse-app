import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import AddDrawer from '@/components/add-drawer';
import SiteForms from './site-forms';
import SitesGrid, { type SiteRow } from './sites-grid';

export const metadata = { title: 'ობიექტები' };

/**
 * The company's warehouses and objects in a table (counters pick from this
 * list when they open a stocktake); "+" adds one or loads a list from Excel in
 * a drawer. Staff have their own page, /manage/team.
 */
export default async function SitesPage({ searchParams }: PageProps<'/manage/sites'>) {
  await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from('sites')
    .select('id, name, address, lat, lng, model_url')
    .order('name')
    .returns<SiteRow[]>();
  const list = data ?? [];
  return (
    <div className="grid gap-4 rounded-2xl bg-paper-sunk p-5">
      <div className="flex flex-wrap items-center gap-3">
        <AddDrawer title="საწყობი / ობიექტი" label="ახალი" startOpen={sp.add === '1'}>
          <SiteForms />
        </AddDrawer>
        <h1 className="text-xl font-semibold tracking-tight">საწყობები და ობიექტები</h1>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">
          ჯერ ცარიელია. „+“-ით დაამატე ან ჩატვირთე Excel-იდან.
        </p>
      ) : (
        <SitesGrid rows={list} />
      )}
    </div>
  );
}
