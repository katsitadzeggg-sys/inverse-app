import type { ActLine } from '@/lib/stock-act';

// Quantities without Balance's trailing zeros: 3, 2.5, -10.
const q4 = (n: number) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false });
const money = (n: number) =>
  n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * The count in Balance's table layout (article, name, group, barcode, unit,
 * book, difference, counted, price, shelf with photo links, comment) and a
 * totals row. Used on the act page and, opened, on the stocktake page.
 */
export default function BalanceTable({
  id,
  lines,
  hasCost,
  scroll = false,
}: {
  id: string;
  lines: ActLine[];
  hasCost: boolean;
  /** In a box of its own height with the header row kept on top. */
  scroll?: boolean;
}) {
  const t = { book: 0, diff: 0, counted: 0, sum: 0 };
  for (const l of lines) {
    t.book += l.book;
    t.diff += l.diff;
    t.counted += l.counted;
    t.sum += l.diff * (l.cost ?? 0);
  }
  // Every shelf with photos/videos, once, for the line under the totals.
  const seen = new Map<string, { id: string; code: string; media: number }>();
  for (const l of lines) for (const sh of l.shelves) if (sh.media) seen.set(sh.id, sh);
  const shelves = [...seen.values()].sort((a, b) =>
    a.code.localeCompare(b.code, 'ka', { numeric: true }),
  );
  const th =
    'border-b border-r border-[#c5ccd6] px-2 py-1.5 font-normal text-[#4a5568] last:border-r-0';
  const td = 'border-b border-r border-[#e2e6ec] px-2 py-1 last:border-r-0';
  return (
    <div
      className={`border-y border-[#c5ccd6] bg-white text-[13px] text-[#1a202c] ${scroll ? 'max-h-[70vh] overflow-auto' : 'overflow-x-auto'}`}
    >
      <table className="w-full min-w-[1100px] border-collapse">
        <thead className="sticky top-0 z-10 bg-[#eef1f5] text-left">
          <tr>
            <th className={`${th} w-10 text-center`}>N</th>
            <th className={th}>სერიული ნომერი</th>
            <th className={th}>ნომენკლატურა</th>
            <th className={th}>ჯგუფი</th>
            <th className={th}>ბარკოდი</th>
            <th className={th}>ერთ.</th>
            {hasCost && <th className={`${th} text-right`}>ფასი</th>}
            <th className={`${th} text-right`}>ფაქტ. რაოდენობა</th>
            <th className={`${th} text-right`}>ბუღალტრული ნაშთი</th>
            <th className={`${th} text-right`}>სხვაობა (რაოდ.)</th>
            {hasCost && <th className={`${th} text-right`}>სხვაობის თანხა</th>}
            <th className={th}>ფოტო</th>
            <th className={th}>კომენტარები</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.n} className="break-inside-avoid even:bg-[#fafbfc]">
              <td className={`${td} text-center text-[#718096]`}>{l.n}</td>
              <td className={`${td} tabular-nums`}>{l.sku}</td>
              <td className={td}>{l.name}</td>
              <td className={`${td} text-[#4a5568]`}>{l.group}</td>
              <td className={`${td} tabular-nums`}>{l.barcode}</td>
              <td className={td}>{l.unit}</td>
              {hasCost && (
                <td className={`${td} text-right tabular-nums`}>
                  {l.cost != null ? money(l.cost) : ''}
                </td>
              )}
              <td className={`${td} text-right font-semibold tabular-nums`}>{q4(l.counted)}</td>
              <td className={`${td} text-right tabular-nums`}>{q4(l.book)}</td>
              <td
                className={`${td} text-right tabular-nums ${l.diff < 0 ? 'text-[#c53030]' : l.diff > 0 ? 'text-[#2b6cb0]' : 'text-[#a0aec0]'}`}
              >
                {q4(l.diff)}
              </td>
              {hasCost && (
                <td className={`${td} text-right tabular-nums`}>
                  {l.diff && l.cost != null ? money(l.diff * l.cost) : ''}
                </td>
              )}
              {/* The photo taken of this very product (separate from the shelf's photos). */}
              <td className={`${td} text-center`}>
                {l.photo && (
                  <a
                    href={l.photo}
                    target="_blank"
                    rel="noreferrer"
                    title="პოზიციის ფოტო — გახსნა"
                    className="text-[#2b6cb0]"
                  >
                    🖼
                  </a>
                )}
              </td>
              <td className={`${td} text-[#4a5568]`}>{l.comment}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-[#eef1f5] font-semibold">
          <tr>
            <td className={td} colSpan={hasCost ? 7 : 6}>
              სულ
            </td>
            <td className={`${td} text-right tabular-nums`}>{q4(t.counted)}</td>
            <td className={`${td} text-right tabular-nums`}>{q4(t.book)}</td>
            <td className={`${td} text-right tabular-nums`}>{q4(t.diff)}</td>
            {hasCost && <td className={`${td} text-right tabular-nums`}>{money(t.sum)}</td>}
            <td className={td} />
            <td className={td} />
            <td className={td} />
          </tr>
          {shelves.length > 0 && (
            <tr>
              <td className={`${td} font-normal`} colSpan={99}>
                <span className="mr-2 text-[#4a5568]">თაროების ფოტო/ვიდეო:</span>
                <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
                  {shelves.map((sh) => (
                    <a
                      key={sh.id}
                      href={`/count/${id}/${sh.id}/done`}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap text-[#2b6cb0] underline print:text-black print:no-underline"
                    >
                      {sh.code} 📷{sh.media}
                    </a>
                  ))}
                </span>
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
