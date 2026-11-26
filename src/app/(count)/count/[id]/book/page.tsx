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
    products: { name: string; sku: string; barcode: string | null } | null;
  };
  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('stocktake_book')
      .select('book_qty, unit_cost, locations (code), products (name, sku, barcode)')
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

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href={`/manage/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-xl font-semibold">ბუღალტრული ნაშთი</h1>
        <p className="text-sm text-ink-soft">
          {count
            ? `ახლა ჩატვირთულია ${count} ხაზი. ახალი ფაილი ძველს ჩაანაცვლებს.`
            : 'ნაშთი ჯერ არ არის ჩატვირთული.'}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          მთვლელები ამ რიცხვებს ვერ ხედავენ. თაროს სვეტი თუ წერია, ზონის დახურვისას სხვაობა მაშინვე
          გამოჩნდება; თუ არა — შედარება ანგარიშში, ბოლოს.
        </p>
      </div>
      {/* Two clear steps: get the template, then load the filled-in file below. */}
      <a
        href="/templates/nashti-shabloni.xlsx"
        download
        className="flex w-fit items-center gap-2 rounded-xl border border-[#155c39] bg-[#1f7a4d] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#155c39]"
      >
        ⬇ 1. შაბლონის ჩამოტვირთვა
        <span className="font-normal opacity-80">
          (დასახელება, შტრიხკოდი, ჯგუფი, რაოდენობა, თარო, ერთეულის ფასი)
        </span>
      </a>
      {stocktake.status === 'open' && (
        <BookFixes
          stocktakeId={id}
          hasBook={count > 0}
          badUnits={badUnits ?? 0}
          shelfMismatch={shelfMismatch}
        />
      )}
      {stocktake.status === 'open' ? (
        <BookImport stocktakeId={id} expiry={stocktake.kind === 'expiry'} />
      ) : (
        <p className="rounded-control border border-rule/70 p-3 text-sm text-ink-soft">
          ინვენტარიზაცია დახურულია — ნაშთი მისი დღისაა და აღარ იცვლება. დღევანდელი ნაშთი ღია
          ინვენტარიზაციაში ჩატვირთე.
        </p>
      )}
      <PhotoLinksImport />
      <p className="text-xs text-ink-faint">
        ღია ინვენტარიზაციაში ჩატვირთული ნაშთი ავტომატურად განახლდება ამავე საწყობის სხვა ღია
        ინვენტარიზაციებშიც; დახურულები ხელუხლებელი რჩება. ნაშთი ერთი დილიდან მეორემდე თუ შეიცვალა და
        პროდუქტი იმ დღეს დაითვალეს — „გადასამოწმებელში“ მოხვდება.
      </p>

      {count > 0 && (
        <details className="rounded-control border border-accent/50 bg-accent/5 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-accent">
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
