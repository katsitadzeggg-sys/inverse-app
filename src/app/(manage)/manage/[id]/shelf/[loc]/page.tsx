import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopbarSlot from '@/components/topbar-slot';
import MediaGallery from '@/components/media-gallery';
import { mapsLink } from '@/lib/geo';
import { loadShelf, shortHome } from '@/app/(count)/count/[id]/[loc]/done/load';
import AiCheck from '@/app/(count)/count/[id]/[loc]/done/ai-check';
import ReopenButton from '@/app/(count)/count/[id]/[loc]/done/reopen-button';

export const metadata = { title: 'თარო' };
// The photo check waits for the vision model.
export const maxDuration = 120;

/**
 * A closed shelf as the manager sees it, wide and light like the rest of the
 * management pages: who counted it, when and where; the differences; the AI
 * photo check; all photos and videos as thumbnails that open large. No
 * counting tools — the manager reviews and, if needed, sends the shelf back.
 */
export default async function ManagerShelfPage({
  params,
}: {
  params: Promise<{ id: string; loc: string }>;
}) {
  const { id, loc } = await params;
  const d = await loadShelf(id, loc);
  if (!d.isManager) redirect(`/count/${id}/${loc}/done`);
  const { st, location, zone, counter, diffs, moved, isAssets, here, away, far } = d;
  const when = new Date(zone.done_at ?? zone.started_at);
  const minus = diffs.filter((x) => x.diff < 0);
  const plus = diffs.filter((x) => x.diff > 0);
  const media = [...d.shelfShots, ...d.productShots].map((m) => ({
    id: m.id,
    kind: m.kind,
    url: m.url,
    poster: m.poster,
    caption: m.caption,
  }));

  return (
    <div className="grid gap-4">
      <TopbarSlot>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/manage/${id}`}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule-strong text-lg hover:bg-paper"
            aria-label="დაბრუნება"
            title="დაბრუნება"
          >
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight">
              {isAssets ? 'ოთახი' : 'თარო'} {location.code}
              <span className="text-base font-normal text-ink-faint">
                {' '}
                · {st.branch ?? st.client_name ?? st.name}
              </span>
            </h1>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-ink-faint">
              <span>👤 {counter?.full_name ?? counter?.email ?? '—'}</span>
              <span>
                · {when.toLocaleDateString('ka-GE')}{' '}
                {when.toLocaleTimeString('ka-GE', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Tbilisi',
                })}
              </span>
              <span>· {st.number}</span>
              {here && (
                <a
                  href={mapsLink(here.lat, here.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className={`hover:underline ${far ? 'font-semibold text-mismatch' : ''}`}
                >
                  · 📍{' '}
                  {away != null
                    ? `საწყობიდან ${away >= 1000 ? `${(away / 1000).toFixed(1)} კმ` : `${away} მ`}${far ? ' ⚠' : ''}`
                    : 'რუკაზე'}
                </a>
              )}
            </p>
          </div>
        </div>
      </TopbarSlot>

      {/* Row 1: the result and the differences, side by side. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_2fr]">
        <section className="grid gap-3 rounded-2xl bg-paper-sunk p-5">
          {isAssets ? (
            <p className="text-base">{d.statement}</p>
          ) : diffs.length === 0 ? (
            <p className="text-xl font-semibold text-match">✓ სხვაობა არ არის</p>
          ) : (
            <p className="text-xl font-semibold text-mismatch">{diffs.length} სხვაობა</p>
          )}
          {!isAssets && diffs.length > 0 && (
            <div className="flex gap-2 text-sm">
              <span className="rounded-full bg-[#fdecec] px-3 py-1 text-mismatch">
                დანაკლისი {minus.length}
              </span>
              <span className="rounded-full bg-[#fdf6d8] px-3 py-1 text-review">
                მეტობა {plus.length}
              </span>
            </div>
          )}
          {zone.note && <p className="text-sm">💬 {zone.note}</p>}
          {st.status === 'open' && (
            <div className="border-t border-rule/60 pt-3">
              <p className="mb-2 text-xs text-ink-faint">
                თუ რამე გადასათვლელია — თარო აღმწერს დაუბრუნდება.
              </p>
              <ReopenButton stocktakeId={id} locationId={loc} back={`/manage/${id}/shelf/${loc}`} />
            </div>
          )}
        </section>

        {!isAssets && (diffs.length > 0 || moved.length > 0) && (
          <section className="rounded-2xl bg-paper-sunk p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="pb-2">პროდუქტი</th>
                  <th className="pb-2">კოდი</th>
                  <th className="pb-2 text-right">სხვაობა</th>
                  <th className="pb-2 pl-3">შენიშვნა</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((x, i) => (
                  <tr key={i} className="border-t border-rule/50">
                    <td className="py-1.5 pr-2 font-medium">{x.name}</td>
                    <td className="py-1.5 pr-2 text-xs text-ink-faint">{x.code}</td>
                    <td
                      className={`py-1.5 text-right font-semibold tabular-nums ${x.diff > 0 ? 'text-review' : 'text-mismatch'}`}
                    >
                      {x.diff > 0 ? `+${x.diff}` : x.diff}
                    </td>
                    <td className="py-1.5 pl-3 text-xs text-ink-soft">
                      {x.diff > 0
                        ? x.home
                          ? `${shortHome(x.home)}-დან გადმოსატანი`
                          : 'მეტობა'
                        : 'დანაკლისი'}
                    </td>
                  </tr>
                ))}
                {moved.map((x, i) => (
                  <tr key={`m${i}`} className="border-t border-rule/50 text-ink-soft">
                    <td className="py-1.5 pr-2">{x.name}</td>
                    <td className="py-1.5 pr-2 text-xs text-ink-faint">{x.code}</td>
                    <td className="py-1.5 text-right">0</td>
                    <td className="py-1.5 pl-3 text-xs text-review">
                      📦 {shortHome(x.home ?? '')}-დან გადმოსატანი
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* Row 2: photos and videos as thumbnails; a tap opens one large. */}
      {media.length > 0 && (
        <section className="grid gap-3 rounded-2xl bg-paper-sunk p-5">
          <h2 className="text-base font-semibold">📷 ფოტო და ვიდეო ({media.length})</h2>
          <MediaGallery items={media} />
        </section>
      )}

      {/* Row 3: the AI photo check. */}
      {!isAssets && d.shelfShots.length > 0 && (
        <div className="rounded-2xl bg-paper-sunk p-1">
          <AiCheck
            stocktakeId={id}
            locationId={loc}
            wide
            photos={d.shelfShots.filter((m) => m.kind === 'photo').length}
            videos={d.shelfShots.filter((m) => m.kind === 'video').map((m) => m.url)}
            last={d.lastAi}
            urls={{
              ...d.frameUrls,
              ...Object.fromEntries(
                d.shelfShots.flatMap((m) => [
                  [m.path, m.url],
                  ...(m.posterPath && m.poster ? [[m.posterPath, m.poster]] : []),
                ]),
              ),
            }}
          />
        </div>
      )}
    </div>
  );
}
