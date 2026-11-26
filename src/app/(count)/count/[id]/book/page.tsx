import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import PhotoLinksImport from './photo-links-import';
import BookImport from './book-import';
import BookFixes from './book-fixes';

export default async function BookPage({ params }: PageProps<'/count/[id]/book'>) {
  const { id } = await params;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: stocktake } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  // The loaded book, shelf by shelf, for the manager to check what went in.
  type Line = {
    book_qty: number;
    unit_cost: number | null;
    locations: { code: string } | null;
    created_at: string;
    products: {
      name: string;
      sku: string;
      barcode: string | null;
      image_url: string | null;
    } | null;
  };
  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('stocktake_book')
      .select(
        'book_qty, unit_cost, created_at, locations (code), products (name, sku, barcode, image_url)',
      )
      .eq('stocktake_id', id)
      .range(from, from + 999)
      .returns<Line[]>();
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const count = lines.length;
  // The balance's shelves vs the shelves counted: none in common = a wrong
  // shelf column (every counted item would show as surplus).
  const { data: zoneRows } = await supabase
    .from('stocktake_zones')
    .select('locations (code)')
    .eq('stocktake_id', id)
    .returns<{ locations: { code: string } | null }[]>();
  const counted = new Set((zoneRows ?? []).map((z) => z.locations?.code).filter(Boolean));
  const bookShelves = new Set(lines.map((l) => l.locations?.code).filter(Boolean) as string[]);
  const shelfMismatch =
    bookShelves.size > 0 && counted.size > 0 && ![...bookShelves].some((c) => counted.has(c))
      ? `ნაშთის თაროები (${[...bookShelves].slice(0, 3).join(', ')}${bookShelves.size > 3 ? '…' : ''}) არცერთი არ ემთხვევა დათვლილ თაროებს (${[...counted].slice(0, 3).join(', ')}${counted.size > 3 ? '…' : ''}) — ამიტომ ყველა დათვლილი მეტობად ჩანს.`
      : null;
  // Units overwritten by a price column (bare numbers): offered a repair.
  const { count: badUnits } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', stocktake.company_id)
    .filter('unit', 'match', '^[0-9]+([.,][0-9]+)?$');
  const byShelf = new Map<string, Line[]>();
  for (const l of lines) {
    const k = l.locations?.code ?? 'თაროს გარეშე';
    byShelf.set(k, [...(byShelf.get(k) ?? []), l]);
  }
  const shelves = [...byShelf.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'ka', { numeric: true }),
  );
  const fmt = (n: number) => Number(n).toLocaleString('ka-GE', { maximumFractionDigits: 3 });
  const units = lines.reduce((t, l) => t + Number(l.book_qty), 0);
  const value = lines.reduce((t, l) => t + Number(l.book_qty) * Number(l.unit_cost ?? 0), 0);
  const withPhoto = new Set(
    lines.filter((l) => l.products?.image_url).map((l) => l.products?.sku ?? ''),
  ).size;
  const loadedAt = lines.reduce((m, l) => (l.created_at > m ? l.created_at : m), '');
  const loaded = loadedAt
    ? new Date(loadedAt).toLocaleString('ka-GE', {
        timeZone: 'Asia/Tbilisi',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const open = stocktake.status === 'open';
  const card = 'grid gap-3 rounded-2xl border border-rule/70 bg-paper-sunk/60 p-5';
  const tile = (label: string, v: string) => (
    <div className="rounded-xl bg-paper px-3 py-2.5">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{v}</p>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/manage/${id}`}
          className="inline-flex items-center rounded-full border border-rule-strong px-4 py-2 text-sm font-medium"
        >
          ← დაბრუნება
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">ნაშთი</h1>
          <p className="text-sm text-ink-faint">
            {stocktake.branch ?? stocktake.name} · {stocktake.number}
          </p>
        </div>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">ახლა ჩატვირთულია</h2>
          {loaded && <span className="text-xs text-ink-faint">{loaded}</span>}
        </div>
        {count ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile('პოზიცია', fmt(count))}
            {tile('ცალი', fmt(Math.round(units)))}
            {tile('თარო', fmt(shelves.filter(([k]) => k !== 'თაროს გარეშე').length))}
            {tile('თანხა, ₾', fmt(Math.round(value)))}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">ნაშთი ჯერ არ არის ჩატვირთული.</p>
        )}
        {open && (
          <BookFixes
            stocktakeId={id}
            hasBook={count > 0}
            badUnits={badUnits ?? 0}
            shelfMismatch={shelfMismatch}
          />
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">
            {count ? 'ახალი ნაშთის ატვირთვა' : 'ნაშთის ატვირთვა'}
          </h2>
          <a
            href="/templates/nashti-shabloni.xlsx"
            download
            className="text-sm text-[#2fbf71] underline decoration-dotted"
          >
            ⬇ შაბლონი
          </a>
        </div>
        {open ? (
          <>
            {count > 0 && (
              <p className="text-xs text-ink-faint">
                ძველს ჩაანაცვლებს · დათვლილი არ იცვლება · ძველი ნაშთი ჟურნალში რჩება
              </p>
            )}
            <BookImport stocktakeId={id} expiry={stocktake.kind === 'expiry'} />
          </>
        ) : (
          <p className="text-sm text-ink-soft">ინვენტარიზაცია დახურულია — ნაშთი აღარ იცვლება.</p>
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">🖼 პროდუქტის ფოტოები</h2>
          {count > 0 && (
            <span className="text-xs text-ink-faint">
              ფოტო აქვს {fmt(withPhoto)} / {fmt(new Set(lines.map((l) => l.products?.sku)).size)}
            </span>
          )}
        </div>
        <PhotoLinksImport />
      </section>

      {count > 0 && (
        <details className="rounded-2xl border border-rule/70 bg-paper-sunk/60 p-5">
          <summary className="cursor-pointer text-base font-semibold">
            📋 ჩატვირთული სია — {count} ხაზი, {shelves.length} თარო
          </summary>
          <div className="mt-3 grid gap-2">
            {shelves.map(([shelf, rows]) => (
              <details key={shelf} className="rounded-control border border-rule/70 px-3 py-2">
                <summary className="cursor-pointer text-sm">
                  <b>{shelf}</b> · {rows.length} პოზიცია ·{' '}
                  {fmt(rows.reduce((t, r) => t + Number(r.book_qty), 0))} ერთ.
                </summary>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-rule/50">
                        <td className="py-1 pr-2">{r.products?.name}</td>
                        <td className="px-2 text-ink-faint tabular-nums">
                          {r.products?.barcode ?? r.products?.sku}
                        </td>
                        <td className="px-2 text-right tabular-nums">{fmt(r.book_qty)}</td>
                        <td className="pl-2 text-right text-ink-faint tabular-nums">
                          {r.unit_cost != null ? `${Number(r.unit_cost).toFixed(2)} ₾` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
