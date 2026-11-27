import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import type { AiResult } from '../../../ai-actions';
import { distanceM } from '@/lib/geo';

/**
 * Everything a closed shelf's page shows: who counted it and when, where,
 * the differences, photos and videos (signed), and the last AI check.
 * Shared by the counter's page and the manager's page. Row-level security
 * keeps every read to the caller's company.
 */
export async function loadShelf(id: string, loc: string) {
  const { userId, profile, company } = await requireSession();
  const supabase = await createClient();

  const [{ data: st }, { data: location }, { data: zone }] = await Promise.all([
    supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>(),
    supabase
      .from('locations')
      .select('id, code, name')
      .eq('id', loc)
      .maybeSingle<{ id: string; code: string; name: string }>(),
    supabase
      .from('stocktake_zones')
      .select('*')
      .eq('stocktake_id', id)
      .eq('location_id', loc)
      .maybeSingle<StocktakeZone>(),
  ]);
  if (!st || !location || !zone) notFound();

  const [{ data: counter }, { count: bookLines }, { data: checks }, { data: media }] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('full_name, email')
        .eq('id', zone.counter_id ?? '')
        .maybeSingle<{ full_name: string | null; email: string }>(),
      supabase
        .from('stocktake_checks')
        .select('id', { count: 'exact', head: true })
        .eq('stocktake_id', id)
        .eq('location_id', loc),
      supabase
        .from('stocktake_checks')
        .select('status')
        .eq('stocktake_id', id)
        .eq('location_id', loc)
        .returns<{ status: string }[]>(),
      supabase
        .from('stocktake_media')
        .select('id, path, kind, poster_path, caption, created_at')
        .eq('stocktake_id', id)
        .eq('location_id', loc)
        .order('created_at')
        .returns<
          {
            id: string;
            path: string;
            kind: 'photo' | 'video';
            poster_path: string | null;
            caption: string | null;
            created_at: string;
          }[]
        >(),
    ]);

  const differences = (checks ?? []).filter((c) => c.status !== 'ok').length;
  const isAssets = st.kind === 'assets';
  const { count: assetCount } = isAssets
    ? await supabase
        .from('asset_checks')
        .select('id', { count: 'exact', head: true })
        .eq('stocktake_id', id)
        .eq('location_id', loc)
    : { count: 0 };
  const when = new Date(zone.done_at ?? zone.started_at);
  const result = isAssets
    ? `ჩაწერილია ${assetCount ?? 0} ძირითადი საშუალება`
    : !bookLines
      ? 'ნაშთთან შედარება არ ჩატარებულა'
      : differences === 0
        ? 'ყველაფერი ზუსტია'
        : `გამოვლინდა ${differences} სხვაობა`;
  const statement =
    `${isAssets ? 'ოთახი' : 'თარო'} აღწერილია. ${counter?.full_name ?? counter?.email ?? ''}, ${when.toLocaleDateString('ka-GE')} ` +
    `${when.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' })}, ` +
    `${st.client_name ?? st.name}${st.branch ? ` / ${st.branch}` : ''}, ${isAssets ? 'ოთახი' : 'თარო'} ${location.code}. ${result}.`;

  // Where the shelf was opened, and how far that is from the warehouse point.
  const here = zone.lat != null && zone.lng != null ? { lat: zone.lat, lng: zone.lng } : null;
  const away =
    here && st.lat != null && st.lng != null
      ? Math.round(distanceM(here, { lat: st.lat, lng: st.lng }))
      : null;
  const far = away != null && away > 300 + (zone.accuracy_m ?? 0);

  const signed = await Promise.all(
    (media ?? []).map(async (m) => {
      const { data } = await supabase.storage
        .from('stocktake-media')
        .createSignedUrl(m.path, 60 * 30);
      const poster = m.poster_path
        ? ((await supabase.storage.from('stocktake-media').createSignedUrl(m.poster_path, 60 * 30))
            .data?.signedUrl ?? null)
        : null;
      return {
        id: m.id,
        path: m.path,
        kind: m.kind,
        url: data?.signedUrl ?? '',
        poster,
        posterPath: m.poster_path,
        caption: m.caption,
        at: m.created_at,
      };
    }),
  );
  const isManager = profile.role === 'owner' || profile.role === 'admin';
  const { data: ai } = isManager
    ? await supabase
        .from('shelf_ai_checks')
        .select('result, created_at, photos')
        .eq('stocktake_id', id)
        .eq('location_id', loc)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ result: AiResult; created_at: string; photos: number }>()
    : { data: null };
  const lastAi = ai ? { result: ai.result, at: ai.created_at, images: ai.photos } : null;
  // Video frames the last check stored: signed here so its boxes are drawn again.
  const mediaPaths = new Set((media ?? []).flatMap((m) => [m.path, m.poster_path]));
  const framePaths = (lastAi?.result.paths ?? []).filter(
    (p): p is string => !!p && !mediaPaths.has(p),
  );
  const frameUrls: Record<string, string> = framePaths.length
    ? Object.fromEntries(
        (
          (await supabase.storage.from('stocktake-media').createSignedUrls(framePaths, 60 * 30))
            .data ?? []
        ).flatMap((x) => (x.path && x.signedUrl ? [[x.path, x.signedUrl] as const] : [])),
      )
    : {};
  // The shelf's own photos (taken at the end) apart from photos of single lines.
  const isLineShot = (m: { path: string }) => /\/product-[^/]+$/.test(m.path);
  const shelfShots = signed.filter((m) => !isLineShot(m));
  const productShots = signed.filter(isLineShot);
  // Stock: the differences of this shelf — book against what was counted.
  type Diff = { name: string; code: string; diff: number; home?: string | null };
  let diffs: Diff[] = [];
  if (!isAssets) {
    // Counters cannot read the book (blind count); the closed shelf's
    // differences come from a database function that may.
    const { data } = await supabase.rpc('shelf_differences_v2', {
      p_stocktake: id,
      p_location: loc,
    });
    diffs = (
      (data ?? []) as { product_name: string; code: string; diff: number; home: string | null }[]
    ).map((r) => ({
      home: r.home,
      name: r.product_name,
      code: r.code,
      diff: Math.round(Number(r.diff) * 1000) / 1000,
    }));
  }

  // Lines that are only "moved" (booked on another shelf, the whole product
  // matches): a note, not a difference.
  const moved = diffs.filter((d) => d.diff === 0 && d.home);
  diffs = diffs.filter((d) => d.diff !== 0);

  const canEdit =
    zone.counter_id === userId || profile.role === 'owner' || profile.role === 'admin';

  return {
    userId,
    profile,
    company,
    st,
    location,
    zone,
    counter,
    differences,
    isAssets,
    statement,
    here,
    away,
    far,
    signed,
    isManager,
    lastAi,
    frameUrls,
    shelfShots,
    productShots,
    diffs,
    moved,
    canEdit,
  };
}

/** A product booked on many shelves: the first two, then "+N". */
export function shortHome(home: string) {
  const all = home
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return all.length > 2 ? `${all.slice(0, 2).join(', ')} +${all.length - 2}` : all.join(', ');
}

export type ShelfData = Awaited<ReturnType<typeof loadShelf>>;
