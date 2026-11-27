import Link from 'next/link';
import ShelfSummaryForm from './summary-form';
import MediaUpload from './media-upload';
import AiCheck from './ai-check';
import AutoCheck from './auto-check';
import ReopenButton from './reopen-button';
import { loadShelf, shortHome } from './load';

// The photo check waits for the vision model.
export const maxDuration = 120;
import { mapsLink } from '@/lib/geo';

/**
 * Shelf summary after closing: one generated statement (who, when, where,
 * which shelf, how many differences remain) plus a free comment, photos and
 * videos of the shelf, then Close or open the next shelf.
 */
export default async function ShelfDonePage({ params }: PageProps<'/count/[id]/[loc]/done'>) {
  const { id, loc } = await params;
  const {
    userId,
    profile,
    company,
    st,
    location,
    zone,
    differences,
    isAssets,
    statement,
    here,
    away,
    far,
    isManager,
    lastAi,
    frameUrls,
    shelfShots,
    productShots,
    diffs,
    moved,
    canEdit,
  } = await loadShelf(id, loc);

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
        <>
          <p className="rounded-control border-2 border-match/60 p-4 text-center text-xl font-semibold text-match">
            ✓ სხვაობა არ არის
          </p>
          <MovedList moved={moved} />
        </>
      ) : (
        <>
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
          <MovedList moved={moved} />
        </>
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

      {/* Counter: the automatic check, when the company has it on. */}
      {!isManager && !isAssets && company.ai_shelf_check && zone.counter_id === userId && (
        <AutoCheck
          stocktakeId={id}
          locationId={loc}
          photos={shelfShots.filter((m) => m.kind === 'photo').length}
          videos={shelfShots.filter((m) => m.kind === 'video').map((m) => m.url)}
          lastShotAt={shelfShots.reduce((a, m) => (m.at > a ? m.at : a), '')}
        />
      )}

      {(isManager || zone.counter_id === userId) && !isAssets && shelfShots.length > 0 && (
        <AiCheck
          stocktakeId={id}
          locationId={loc}
          photos={shelfShots.filter((m) => m.kind === 'photo').length}
          videos={shelfShots.filter((m) => m.kind === 'video').map((m) => m.url)}
          last={lastAi}
          urls={{
            ...frameUrls,
            ...Object.fromEntries(
              shelfShots.flatMap((m) => [
                [m.path, m.url],
                ...(m.posterPath && m.poster ? [[m.posterPath, m.poster]] : []),
              ]),
            ),
          }}
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

      {canEdit && st.status === 'open' && <ReopenButton stocktakeId={id} locationId={loc} />}

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

/** Found here, booked on another shelf, whole quantity right: only to move. */
function MovedList({ moved }: { moved: { name: string; code: string; home?: string | null }[] }) {
  if (!moved.length) return null;
  return (
    <section className="grid gap-1.5 rounded-control border border-review/50 p-3">
      <p className="text-sm font-semibold text-review">📦 სხვა თაროზეა ჩაწერილი — გადმოსატანი</p>
      <ul className="grid gap-1">
        {moved.map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {d.name} <span className="text-xs text-ink-faint">{d.code}</span>
            </span>
            <span className="shrink-0 text-xs text-review">{shortHome(d.home ?? '')}-დან</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
