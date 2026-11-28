import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CONDITION } from '@/lib/assets-result';

export const metadata = { title: 'ძირითადი საშუალება' };

type Check = {
  id: string;
  name: string;
  condition: string;
  responsible: string | null;
  serial: string | null;
  note: string | null;
  checked_at: string;
  locations: { code: string; name: string | null } | null;
  stocktakes: { number: string; branch: string | null } | null;
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('ka-GE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Where a fixed asset's QR sticker leads (app.inverse.ge/inv/FA-0012): its
 * card with the photos taken at the counts. Signed-in users of the asset's
 * company only — the proxy sends others to the login and back here, and every
 * read is limited to the user's own company (row-level security and an
 * explicit company filter), so one client's numbers never show another's.
 */
export default async function AssetCardPage({ params }: PageProps<'/inv/[code]'>) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim();
  const { company } = await requireSession();
  const supabase = await createClient();
  const codes = [...new Set([code, code.toUpperCase()])];

  const [{ data: reg }, { data: checks }] = await Promise.all([
    supabase
      .from('asset_register')
      .select('inv_no, name, room, responsible, serial, value')
      .eq('company_id', company.id)
      .in('inv_no', codes)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('asset_checks')
      .select(
        'id, name, condition, responsible, serial, note, checked_at, locations (code, name), stocktakes (number, branch)',
      )
      .eq('company_id', company.id)
      .in('inv_no', codes)
      .order('checked_at', { ascending: false })
      .limit(10)
      .returns<Check[]>(),
  ]);

  const ids = (checks ?? []).map((c) => c.id);
  const { data: media } = ids.length
    ? await supabase
        .from('stocktake_media')
        .select('path, kind, poster_path, asset_check_id, created_at')
        .eq('company_id', company.id)
        .in('asset_check_id', ids)
        .order('created_at', { ascending: false })
        .limit(40)
    : { data: [] };
  const paths = (media ?? []).flatMap((m) =>
    [m.path as string, m.poster_path as string | null].filter((p): p is string => !!p),
  );
  const { data: signed } = paths.length
    ? await supabase.storage.from('stocktake-media').createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const r = reg?.[0];
  const last = checks?.[0];
  const name = r?.name ?? last?.name;

  if (!r && !last)
    return (
      <main className="mx-auto grid max-w-xl gap-3 p-6">
        <h1 className="text-2xl font-semibold">{code}</h1>
        <p className="text-ink-soft">
          ეს ნომერი {company.name}-ის რეესტრში და დათვლებში არ მოიძებნა.
        </p>
        <Link href="/count" className="text-sm underline">
          აპში დაბრუნება
        </Link>
      </main>
    );

  const facts: [string, string | null | undefined][] = [
    ['ოთახი / ადგილი', last?.locations?.code ?? r?.room],
    ['პასუხისმგებელი', last?.responsible ?? r?.responsible],
    ['სერიული №', last?.serial ?? r?.serial],
    ['მდგომარეობა', last ? (CONDITION[last.condition] ?? last.condition) : null],
    [
      'ბოლო დათვლა',
      last
        ? `${date(last.checked_at)}${last.stocktakes ? ` · ${last.stocktakes.branch ?? ''} ${last.stocktakes.number}` : ''}`
        : 'ჯერ არ დათვლილა',
    ],
  ];

  return (
    <main className="mx-auto grid max-w-3xl gap-5 p-5">
      <header className="grid gap-1 rounded-2xl bg-paper-sunk p-5">
        <p className="text-xs text-ink-faint">{company.name} · ძირითადი საშუალება</p>
        <h1 className="text-3xl font-bold tracking-tight">{code}</h1>
        {name && <p className="text-lg">{name}</p>}
      </header>

      <dl className="grid gap-x-6 gap-y-2 rounded-2xl bg-paper-sunk p-5 text-sm sm:grid-cols-2">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid gap-0.5">
              <dt className="text-xs text-ink-faint">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        {last?.note && (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-xs text-ink-faint">შენიშვნა</dt>
            <dd>{last.note}</dd>
          </div>
        )}
      </dl>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">ფოტოები</h2>
        {media && media.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((m) => {
              const src = url.get(m.path as string);
              if (!src) return null;
              return m.kind === 'video' ? (
                <video
                  key={m.path as string}
                  src={src}
                  poster={
                    m.poster_path ? (url.get(m.poster_path as string) ?? undefined) : undefined
                  }
                  controls
                  playsInline
                  className="aspect-square w-full rounded-xl bg-black object-cover"
                />
              ) : (
                <a key={m.path as string} href={src} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                  <img
                    src={src}
                    alt={`${code} — ${date(m.created_at as string)}`}
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                </a>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">ფოტო ჯერ არ არის — დათვლისას გადაიღება.</p>
        )}
      </section>
    </main>
  );
}
