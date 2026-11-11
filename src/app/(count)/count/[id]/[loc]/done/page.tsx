import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import ShelfSummaryForm from './summary-form';
import MediaUpload from './media-upload';
import { distanceM, mapsLink } from '@/lib/geo';

/**
 * Shelf summary after closing: one generated statement (who, when, where,
 * which shelf, how many differences remain) plus a free comment, photos and
 * videos of the shelf, then Close or open the next shelf.
 */
/** A product booked on many shelves: the first two, then "+N". */
function shortHome(home: string) {
  const all = home
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return all.length > 2 ? `${all.slice(0, 2).join(', ')} +${all.length - 2}` : all.join(', ');
}

export default async function ShelfDonePage({ params }: PageProps<'/count/[id]/[loc]/done'>) {
  const { id, loc } = await params;
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
        .select('id, path, kind, poster_path, caption')
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
        caption: m.caption,
      };
    }),
  );
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

  const canEdit =
    zone.counter_id === userId || profile.role === 'owner' || profile.role === 'admin';

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href={`/count/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{location.code}</h1>
      </div>

      {isAssets ? (
        <div
          className={`rounded-control border-2 p-4 ${differences && !isAssets ? 'border-mismatch/50' : 'border-match/50'}`}
        >
          <p className="text-base leading-relaxed">{statement}</p>
          <p className="mt-2 text-sm text-ink-soft">
            {st.address && <>მისამართი: {st.address}. </>}
            {here ? (
              <>
                📍{' '}
                <a
                  href={mapsLink(here.lat, here.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  აღწერის ადგილი რუკაზე
                </a>
                {zone.accuracy_m != null && <> (±{Math.round(zone.accuracy_m)} მ)</>}
                {away != null && (
                  <span className={far ? ' font-semibold text-mismatch' : ''}>
                    {' '}
                    · საწყობიდან {away >= 1000 ? `${(away / 1000).toFixed(1)} კმ` : `${away} მ`}
                    {far ? ' ⚠' : ''}
                  </span>
                )}
              </>
            ) : (
              'მდებარეობა არ ჩაწერილა.'
            )}
          </p>
        </div>
      ) : diffs.length === 0 ? (
        <p className="rounded-control border-2 border-match/60 p-4 text-center text-xl font-semibold text-match">
          ✓ სხვაობა არ არის
        </p>
      ) : (
        <section className="grid gap-2 rounded-control border-2 border-mismatch/50 p-3">
          <p className="text-lg font-semibold">სხვაობები: {diffs.length}</p>
          <ul className="grid gap-1.5">
            {diffs.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-t border-rule/60 pt-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-medium leading-tight">{d.name}</p>
                  <p className="text-xs text-ink-faint">{d.code}</p>
                </div>
                <p
                  className={`max-w-[45%] shrink-0 text-right text-xl font-semibold tabular-nums ${d.diff > 0 ? 'text-review' : 'text-mismatch'}`}
                >
                  {d.diff > 0 ? `+${d.diff}` : d.diff}
                  <span className="block break-words text-xs font-normal">
                    {d.diff > 0
                      ? d.home
                        ? `${shortHome(d.home)}-დან გადმოსატანი`
                        : 'მეტობა'
                      : 'დანაკლისი'}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && !isAssets && (
        <MediaUpload
          stocktakeId={id}
          locationId={loc}
          companyId={company.id}
          userId={userId}
          author={profile.full_name ?? profile.email}
          company={st.client_name ?? st.name}
          branch={st.branch}
          shelf={location.code}
          items={shelfShots}
        />
      )}

      {/* Photos taken for single lines (new products), each with its line. */}
      {productShots.length > 0 && (
        <section className="grid gap-2 rounded-control border border-rule/70 p-3">
          <p className="font-semibold">🆕 პოზიციების ფოტოები ({productShots.length})</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {productShots.map((m) => (
              <li key={m.id} className="grid grid-cols-[5rem_1fr] items-center gap-3">
                {m.kind === 'video' ? (
                  <video
                    src={m.url}
                    poster={m.poster ?? undefined}
                    controls
                    playsInline
                    preload="none"
                    className="aspect-square w-20 rounded-control bg-black object-cover"
                  />
                ) : (
                  <a href={m.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.url}
                      alt=""
                      className="aspect-square w-20 rounded-control object-cover"
                    />
                  </a>
                )}
                <span className="text-sm">
                  {(m.caption ?? '').replace(/^ახალი პროდუქტი:\s*/, '')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit ? (
        <ShelfSummaryForm
          stocktakeId={id}
          locationId={loc}
          note={zone.note ?? ''}
          rooms={isAssets}
        />
      ) : (
        zone.note && <p className="rounded-control border border-rule/70 p-3">💬 {zone.note}</p>
      )}
    </div>
  );
}
