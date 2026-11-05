import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import AutoRefresh from './auto-refresh';
import Map3D from './map-3d';

type State = 'idle' | 'counting' | 'ok' | 'diff';

const STYLE: Record<State, string> = {
  idle: 'border-rule bg-paper-sunk text-ink-faint',
  counting: 'border-review bg-review/15 text-ink',
  ok: 'border-match bg-match/15 text-ink',
  diff: 'border-mismatch bg-mismatch/15 text-ink',
};
const LABEL: Record<State, string> = { idle: 'არ გახსნილა', counting: 'ითვლება', ok: 'დათვლილია, ემთხვევა', diff: 'სხვაობაა' };

/** Groups shelf codes by their leading letters: A-01, A-02 → row "A". */
const rowOf = (code: string) => (code.match(/^[^\d]+/)?.[0] ?? '#').replace(/[-\s.]+$/, '') || '#';
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Live map of the stocktake: every shelf (or room) as a tile, coloured by
 * state — not opened yet, being counted (and by whom), done and matching,
 * done with differences. Shelves in the book that nobody opened show grey.
 * Refreshes itself every 30 seconds.
 */
export default async function StocktakeMap({ params, searchParams }: PageProps<'/manage/[id]/map'>) {
  const { id } = await params;
  const view3d = (await searchParams).view === '3d';
  await requireSession();
  const supabase = await createClient();
  const { data: st } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!st) notFound();

  const [{ data: zones }, { data: checks }, { data: book }] = await Promise.all([
    supabase.from('stocktake_zones').select('location_id, status, locations (code), user_profiles (full_name, email)').eq('stocktake_id', id)
      .returns<{ location_id: string; status: string; locations: { code: string } | null; user_profiles: { full_name: string | null; email: string } | null }[]>(),
    supabase.from('stocktake_checks').select('location_id, status').eq('stocktake_id', id).neq('status', 'ok')
      .returns<{ location_id: string; status: string }[]>(),
    supabase.from('stocktake_book').select('location_id, locations (code)').eq('stocktake_id', id).not('location_id', 'is', null).limit(20000)
      .returns<{ location_id: string; locations: { code: string } | null }[]>(),
  ]);

  const diffs = new Set((checks ?? []).map((c) => c.location_id));
  const tiles = new Map<string, { code: string; state: State; who?: string; href?: string }>();
  for (const b of book ?? []) if (b.locations) tiles.set(b.location_id, { code: b.locations.code, state: 'idle' });
  for (const z of zones ?? []) {
    const state: State = z.status !== 'done' ? 'counting' : diffs.has(z.location_id) ? 'diff' : 'ok';
    tiles.set(z.location_id, {
      code: z.locations?.code ?? '?',
      state,
      who: z.user_profiles?.full_name ?? z.user_profiles?.email,
      href: `/count/${id}/${z.location_id}/done`,
    });
  }
  const rows = new Map<string, typeof tiles extends Map<string, infer T> ? T[] : never>();
  for (const t of tiles.values()) rows.set(rowOf(t.code), [...(rows.get(rowOf(t.code)) ?? []), t]);
  const ordered = [...rows.entries()].sort((a, b) => natural(a[0], b[0]));
  const counts = (s: State) => [...tiles.values()].filter((t) => t.state === s).length;
  const all = tiles.size;

  return (
    <div className="grid gap-5">
      <AutoRefresh />
      <div>
        <Link href={`/manage/${id}`} className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink">← დაბრუნება</Link>
        <h1 className="mt-1 text-xl font-semibold">რუკა · {st.client_name ?? st.name}</h1>
        <p className="text-sm text-ink-soft">ახლდება ყოველ 30 წამში. დააჭირე თაროს — გაიხსნება მისი შედეგი.</p>
        <div className="mt-2 flex gap-2 text-sm">
          <Link href={`/manage/${id}/map`} className={`rounded-control border px-3 py-2 ${!view3d ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}>▦ ბადე</Link>
          <Link href={`/manage/${id}/map?view=3d`} className={`rounded-control border px-3 py-2 ${view3d ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}>🧊 3D</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(['ok', 'diff', 'counting', 'idle'] as State[]).map((s) => (
          <div key={s} className={`rounded-control border-2 p-3 ${STYLE[s]}`}>
            <p className="text-2xl font-semibold">{counts(s)}</p>
            {LABEL[s]}
          </div>
        ))}
      </div>
      {all > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full bg-paper-sunk">
          <div className="bg-match" style={{ width: `${(counts('ok') / all) * 100}%` }} />
          <div className="bg-mismatch" style={{ width: `${(counts('diff') / all) * 100}%` }} />
          <div className="bg-review" style={{ width: `${(counts('counting') / all) * 100}%` }} />
        </div>
      )}

      {all > 0 && view3d ? (
        <Map3D rows={ordered.map(([row, list]) => ({ row, tiles: [...list].sort((a, b) => natural(a.code, b.code)) }))} />
      ) : all === 0 ? (
        <p className="text-sm text-ink-soft">ჯერ არცერთი თარო არ არის: ჩატვირთე ნაშთი თაროს სვეტით ან დაიწყე დათვლა.</p>
      ) : (
        <div className="grid gap-3">
          {ordered.map(([row, list]) => (
            <section key={row} className="grid grid-cols-[3rem_1fr] items-start gap-2">
              <p className="pt-2 text-lg font-semibold text-ink-soft">{row}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.sort((a, b) => natural(a.code, b.code)).map((t) => {
                  const tile = (
                    <span title={`${t.code} · ${LABEL[t.state]}${t.who ? ` · ${t.who}` : ''}`} className={`grid min-w-14 place-items-center rounded-md border-2 px-2 py-2 text-sm font-semibold tabular-nums ${STYLE[t.state]}`}>
                      {t.code}
                      {t.state === 'counting' && t.who && <span className="max-w-20 truncate text-[10px] font-normal">{t.who.split(' ')[0]}</span>}
                    </span>
                  );
                  return t.href ? <Link key={t.code} href={t.href}>{tile}</Link> : <span key={t.code}>{tile}</span>;
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
