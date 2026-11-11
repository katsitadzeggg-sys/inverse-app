import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { mapsLink } from '@/lib/geo';
import SiteForms from './site-forms';
import TeamSection from '../team/team-section';
import DeleteSite from './delete-site';
import { setSiteModel } from './actions';

export const metadata = { title: 'მართვის პანელი' };

type Site = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  model_url: string | null;
};

/**
 * Control panel: the company's warehouses and objects (counters pick from this
 * list when they open a stocktake) and its staff (invite, modules, remove).
 */
export default async function SitesPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from('sites')
    .select('id, name, address, lat, lng, model_url')
    .order('name')
    .returns<Site[]>();
  const list = data ?? [];
  return (
    <div className="space-y-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <TeamSection />
        <section className="grid min-w-0 content-start gap-4">
          <h2 className="text-xl font-semibold tracking-tight">🏬 საწყობები და ობიექტები</h2>
          <SiteForms />
          <details className="rounded-control border border-accent/50 bg-accent/5 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-accent">
              სია და ცვლილებები ({list.length})
            </summary>
            <div className="mt-3">
              {list.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  ჯერ ცარიელია. დაამატე მარჯვნივ ან ჩატვირთე Excel-იდან.
                </p>
              ) : (
                <ul className="divide-y divide-rule/70">
                  {list.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium">{s.name}</p>
                        <p className="truncate text-xs text-ink-faint">
                          {s.address ?? 'მისამართი არ არის'}
                          {s.lat != null && s.lng != null && (
                            <>
                              {' '}
                              ·{' '}
                              <a
                                href={mapsLink(s.lat, s.lng)}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                რუკა
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        {/* 🏗 the warehouse in 3D: open it, or set its link. */}
                        {s.model_url && (
                          <a
                            href={s.model_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-control border border-accent/60 px-2 py-0.5 text-xs font-semibold text-accent"
                          >
                            🏗 3D
                          </a>
                        )}
                        <details className="text-xs">
                          <summary className="text-ink-faint underline">3D ბმული</summary>
                          <form action={setSiteModel.bind(null, s.id)} className="mt-1 flex gap-1">
                            <input
                              name="model_url"
                              type="url"
                              defaultValue={s.model_url ?? ''}
                              placeholder="https://…"
                              className="w-44 rounded-control border border-rule-strong bg-paper-sunk px-2 py-1"
                            />
                            <button
                              type="submit"
                              className="rounded-control border border-rule-strong px-2 py-1"
                            >
                              ✓
                            </button>
                          </form>
                        </details>
                        <DeleteSite id={s.id} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
