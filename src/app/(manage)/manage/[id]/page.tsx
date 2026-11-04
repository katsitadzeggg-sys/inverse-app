import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import { mapsLink } from '@/lib/geo';
import { setStocktakeStatus } from '@/app/(count)/count/actions';
import ExportBox from './export-box';

type ZoneRow = StocktakeZone & {
  locations: { code: string } | null;
  user_profiles: { full_name: string | null; email: string } | null;
};

/**
 * Everything the manager receives from one stocktake: details, book import,
 * differences, downloads, and every shelf with who counted it, when, where,
 * how many lines, open differences, notes and photos.
 */
export default async function ManageStocktake({ params }: PageProps<'/manage/[id]'>) {
  const { id } = await params;
  await requireSession();
  const supabase = await createClient();

  const { data: st } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!st) notFound();

  const [{ data: zones }, { data: entries }, { data: checks }, { data: media }, { count: bookLines }] = await Promise.all([
    supabase.from('stocktake_zones').select('*, locations (code), user_profiles (full_name, email)').eq('stocktake_id', id).order('started_at')
      .returns<ZoneRow[]>(),
    supabase.from('stocktake_entries').select('location_id').eq('stocktake_id', id).limit(20000).returns<{ location_id: string }[]>(),
    supabase.from('stocktake_checks').select('location_id, status').eq('stocktake_id', id).neq('status', 'ok').returns<{ location_id: string; status: string }[]>(),
    supabase.from('stocktake_media').select('location_id').eq('stocktake_id', id).returns<{ location_id: string }[]>(),
    supabase.from('stocktake_book').select('id', { count: 'exact', head: true }).eq('stocktake_id', id),
  ]);
  const count = (rows: { location_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.location_id, (m.get(r.location_id) ?? 0) + 1);
    return m;
  };
  const lines = count(entries);
  const diffs = count(checks);
  const shots = count(media);
  const list = zones ?? [];
  const done = list.filter((z) => z.status === 'done').length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link href="/manage" className="text-sm text-ink-faint">← ინვენტარიზაციები</Link>
        <p className="text-sm text-ink-faint">{st.number} · {new Date(st.count_date).toLocaleDateString('ka-GE')}</p>
        <h1 className="text-2xl font-semibold">{st.client_name ?? st.name}</h1>
        {st.branch && <p className="text-ink-soft">{st.branch}</p>}
        {(st.address || st.lat != null) && (
          <p className="text-sm text-ink-soft">
            📍 {st.address ?? ''}{' '}
            {st.lat != null && st.lng != null && <a href={mapsLink(st.lat, st.lng)} target="_blank" rel="noreferrer" className="underline">რუკაზე</a>}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold">{done}/{list.length}</p>თარო დასრულდა</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold">{entries?.length ?? 0}</p>ჩანაწერი</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold text-mismatch">{checks?.length ?? 0}</p>სხვაობა</div>
        <div className="rounded-control border border-rule/70 p-3"><p className="text-2xl font-semibold">{bookLines ?? 0}</p>ხაზი ნაშთში</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Link href={`/count/${id}/book`} className="rounded-control border border-rule-strong px-3 py-3 text-center">📄 ნაშთის ჩატვირთვა</Link>
        <Link href={`/count/${id}/report`} className="rounded-control border border-rule-strong px-3 py-3 text-center">📊 სხვაობები</Link>
      </div>

      {list.length > 0 && <ExportBox stocktakeId={id} number={st.number} shelves={list.map((z) => ({ id: z.location_id, code: z.locations?.code ?? '' }))} />}

      <section className="grid gap-2">
        <h2 className="font-semibold">თაროები</h2>
        {list.length === 0 ? (
          <p className="text-sm text-ink-soft">ჯერ არცერთი თარო არ გახსნილა.</p>
        ) : (
          <div className="overflow-x-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left text-xs text-ink-faint">
                <tr>
                  <th className="p-2">თარო</th><th className="p-2">აღმწერი</th><th className="p-2">სტატუსი</th>
                  <th className="p-2 text-right">ჩანაწ.</th><th className="p-2 text-right">სხვაობა</th><th className="p-2">📷</th><th className="p-2">📍</th><th className="p-2">კომენტარი</th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => (
                  <tr key={z.id} className="border-t border-rule/60 align-top">
                    <td className="p-2 font-semibold">
                      <Link href={`/count/${id}/${z.location_id}/done`} className="underline">{z.locations?.code}</Link>
                    </td>
                    <td className="p-2">{z.user_profiles?.full_name ?? z.user_profiles?.email}</td>
                    <td className={`p-2 ${z.status === 'done' ? 'text-match' : 'text-review'}`}>
                      {z.status === 'done' ? `✓ ${new Date(z.done_at ?? z.started_at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })}` : 'ითვლება'}
                    </td>
                    <td className="p-2 text-right tabular-nums">{lines.get(z.location_id) ?? 0}</td>
                    <td className={`p-2 text-right tabular-nums ${diffs.get(z.location_id) ? 'font-semibold text-mismatch' : ''}`}>{diffs.get(z.location_id) ?? 0}</td>
                    <td className="p-2">{shots.get(z.location_id) ?? ''}</td>
                    <td className="p-2">{z.lat != null && z.lng != null ? <a href={mapsLink(z.lat, z.lng)} target="_blank" rel="noreferrer" className="underline">რუკა</a> : ''}</td>
                    <td className="p-2 text-ink-soft">{z.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form action={setStocktakeStatus.bind(null, id, st.status === 'open' ? 'closed' : 'open')}>
        <button type="submit" className="rounded-control border border-rule-strong px-4 py-3 text-sm">
          {st.status === 'open' ? '🔒 ინვენტარიზაციის დახურვა' : '↺ ხელახლა გახსნა'}
        </button>
      </form>
    </div>
  );
}
