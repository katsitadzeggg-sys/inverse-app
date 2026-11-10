import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import { stockActData } from '@/lib/stock-act';
import PrintButton from './print-button';

const q4 = (n: number) =>
  Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
    useGrouping: false,
  });
const money = (n: number) =>
  n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * Stock count act laid out like Balance's "ინვენტარიზაცია" document:
 * number, date, warehouse; lines N · article · name · main barcode · unit ·
 * book · difference · counted · comment; totals and amounts at the bottom.
 * Printable with signature lines; downloadable as Excel in the same columns.
 */
export default async function StockAct({ params, searchParams }: PageProps<'/manage/[id]/act'>) {
  const { id } = await params;
  const onlyDiff = (await searchParams).only === 'diff';
  await requireSession();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('stocktakes')
    .select('*')
    .eq('id', id)
    .maybeSingle<Stocktake>();
  if (!st) notFound();
  if (st.kind === 'assets') redirect(`/count/${id}/report`);

  const { lines: all, hasCost, totals: t, team } = await stockActData(supabase, id);
  const diffCount = all.filter((l) => l.diff !== 0).length;
  const lines = onlyDiff ? all.filter((l) => l.diff !== 0) : all;
  const date = new Date(st.count_date).toLocaleDateString('ka-GE');
  const th =
    'border-b border-r border-[#c5ccd6] px-2 py-1.5 font-normal text-[#4a5568] last:border-r-0';
  const td = 'border-b border-r border-[#e2e6ec] px-2 py-1 last:border-r-0';
  const field = 'rounded-[3px] border border-[#b9c2ce] bg-white px-2 py-1';

  return (
    <div className="grid gap-4">
      <div className="no-print flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/manage/${id}`}
          className="rounded-control border border-rule-strong px-4 py-2 text-base font-medium"
        >
          ← დაბრუნება
        </Link>
        <PrintButton />
        <a
          href={`/manage/${id}/act/xlsx${onlyDiff ? '?only=diff' : ''}`}
          className="rounded-control border border-rule-strong px-4 py-3 text-base font-medium"
        >
          ⬇ Excel (ბალანსის ფორმით)
        </a>
      </div>

      <article
        id="stock-act"
        className="mx-auto w-full max-w-6xl overflow-hidden rounded-md border border-[#c5ccd6] bg-[#f4f6f9] text-[13px] text-[#1a202c] print:rounded-none print:border-0 print:bg-white"
      >
        {/* Title bar, as in Balance */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#c5ccd6] bg-white px-4 py-3">
          <h1 className="text-lg font-semibold">
            ინვენტარიზაცია {st.number} - {date}
          </h1>
          <span className="text-sm text-[#2f855a] print:hidden">
            {st.status === 'open' ? '● მიმდინარე' : '✓ დახურული'}
          </span>
        </div>

        <div className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[auto_auto_1fr]">
          <label className="flex items-center gap-2">
            <span className="text-[#4a5568]">ნომერი:</span>
            <span className={`${field} tabular-nums`}>{st.number}</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[#4a5568]">თარიღი:</span>
            <span className={`${field} tabular-nums`}>{date}</span>
          </label>
          <label className="flex min-w-0 items-center gap-2">
            <span className="text-[#4a5568]">საწყობი:</span>
            <span className={`${field} min-w-0 flex-1 truncate`}>
              {st.branch ?? st.client_name ?? st.name}
            </span>
          </label>
          <p className="text-[#4a5568] sm:col-span-3">
            ორგანიზაცია: <b className="text-[#1a202c]">{st.client_name ?? st.name}</b>
            {st.address && <> · {st.address}</>}
            {team.length > 0 && <> · აღმწერები: {team.join(', ')}</>}
          </p>
        </div>

        {/* Tabs: all lines / differences only */}
        <div className="flex gap-1 px-4 print:hidden">
          <Link
            href={`/manage/${id}/act`}
            className={`rounded-t-[4px] border border-b-0 px-3 py-1.5 ${!onlyDiff ? 'border-[#c5ccd6] bg-white font-semibold' : 'border-transparent text-[#4a5568]'}`}
          >
            საქონელი ({all.length})
          </Link>
          <Link
            href={`/manage/${id}/act?only=diff`}
            className={`rounded-t-[4px] border border-b-0 px-3 py-1.5 ${onlyDiff ? 'border-[#c5ccd6] bg-white font-semibold' : 'border-transparent text-[#4a5568]'}`}
          >
            მხოლოდ სხვაობები ({diffCount})
          </Link>
        </div>

        <div className="overflow-x-auto border-y border-[#c5ccd6] bg-white">
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="bg-[#eef1f5] text-left">
              <tr>
                <th className={`${th} w-10 text-center`}>N</th>
                <th className={th}>არტიკული</th>
                <th className={th}>ნომენკლატურა</th>
                <th className={th}>ძირითადი შტრიხკოდი</th>
                <th className={th}>ერთ.</th>
                <th className={`${th} text-right`}>აღრიცხვით</th>
                <th className={`${th} text-right`}>სხვაობა (რაოდ.)</th>
                <th className={`${th} text-right`}>ფაქტ. რაოდენობა</th>
                {hasCost && <th className={`${th} text-right`}>ფასი</th>}
                {hasCost && <th className={`${th} text-right`}>სხვაობის თანხა</th>}
                <th className={th}>კომენტარები</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.n} className="break-inside-avoid even:bg-[#fafbfc]">
                  <td className={`${td} text-center text-[#718096]`}>{l.n}</td>
                  <td className={`${td} tabular-nums`}>{l.sku}</td>
                  <td className={td}>{l.name}</td>
                  <td className={`${td} tabular-nums`}>{l.barcode}</td>
                  <td className={td}>{l.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{q4(l.book)}</td>
                  <td
                    className={`${td} text-right tabular-nums ${l.diff < 0 ? 'text-[#c53030]' : l.diff > 0 ? 'text-[#2b6cb0]' : 'text-[#a0aec0]'}`}
                  >
                    {q4(l.diff)}
                  </td>
                  <td className={`${td} text-right font-semibold tabular-nums`}>{q4(l.counted)}</td>
                  {hasCost && (
                    <td className={`${td} text-right tabular-nums`}>
                      {l.cost != null ? money(l.cost) : ''}
                    </td>
                  )}
                  {hasCost && (
                    <td className={`${td} text-right tabular-nums`}>
                      {l.diff && l.cost != null ? money(l.diff * l.cost) : ''}
                    </td>
                  )}
                  <td className={`${td} text-[#4a5568]`}>{l.comment}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#eef1f5] font-semibold">
              <tr>
                <td className={td} colSpan={5}>
                  სულ
                </td>
                <td className={`${td} text-right tabular-nums`}>{q4(t.book)}</td>
                <td className={`${td} text-right tabular-nums`}>{q4(t.diff)}</td>
                <td className={`${td} text-right tabular-nums`}>{q4(t.counted)}</td>
                {hasCost && <td className={td} />}
                {hasCost && (
                  <td className={`${td} text-right tabular-nums`}>
                    {money(t.plusSum - t.minusSum)}
                  </td>
                )}
                <td className={td} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Amounts at the bottom, as in Balance */}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-[#4a5568]">
            პოზიცია: <b className="text-[#1a202c]">{all.length}</b> · ემთხვევა:{' '}
            <b className="text-[#1a202c]">{all.length - diffCount}</b> · მეტობა:{' '}
            <b className="text-[#2b6cb0]">{all.filter((l) => l.diff > 0).length}</b> · დანაკლისი:{' '}
            <b className="text-[#c53030]">{all.filter((l) => l.diff < 0).length}</b>
          </span>
          {hasCost && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-[#4a5568]">თანხა:</span>
                <span className={`${field} min-w-24 text-right tabular-nums`}>
                  {money(t.countedSum)}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[#4a5568]">აღრიცხვის თანხა:</span>
                <span className={`${field} min-w-24 text-right tabular-nums`}>
                  {money(t.bookSum)}
                </span>
              </label>
            </>
          )}
        </div>
        {hasCost && (
          <p className="px-4 pb-3 text-right text-[#4a5568]">
            მეტობა <b className="text-[#2b6cb0]">{money(t.plusSum)} ₾</b> · დანაკლისი{' '}
            <b className="text-[#c53030]">{money(t.minusSum)} ₾</b>
          </p>
        )}

        <section className="grid gap-6 border-t border-[#c5ccd6] bg-white px-4 py-6 break-inside-avoid">
          {[
            'კომისიის თავმჯდომარე',
            'კომისიის წევრი',
            'კომისიის წევრი',
            'მატერიალურად პასუხისმგებელი პირი',
          ].map((role, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_8rem] items-end gap-4">
              <span>{role}:</span>
              <span className="border-b border-black" />
              <span className="border-b border-black text-center text-xs text-gray-500">
                ხელმოწერა
              </span>
            </div>
          ))}
          <p className="text-xs text-gray-600">
            მატერიალურად პასუხისმგებელი პირი ადასტურებს, რომ ინვენტარიზაცია ჩატარდა მისი
            თანდასწრებით და პრეტენზია არ გააჩნია.
          </p>
        </section>
      </article>
    </div>
  );
}
