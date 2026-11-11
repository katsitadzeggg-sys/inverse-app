import Link from 'next/link';
import { ASSET_STATUS, CONDITION, type AssetRow, type AssetStatus } from '@/lib/assets-result';

const TONE: Record<AssetStatus, string> = {
  found: 'text-match',
  moved: 'text-review',
  missing: 'text-mismatch',
  surplus: 'text-mismatch',
};
const money = (n: number) =>
  `${n.toLocaleString('ka-GE', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ₾`;

function Rows({ rows }: { rows: AssetRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-faint">
          <tr>
            <th className="py-1 pr-2">ინვ. №</th>
            <th className="px-2">დასახელება</th>
            <th className="px-2">ჯგუფი</th>
            <th className="px-2">რეესტრით</th>
            <th className="px-2">ფაქტობრივად</th>
            <th className="px-2">მდგომარეობა</th>
            <th className="pl-2">📷</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invNo} className="border-t border-rule/60 align-top">
              <td className="py-1.5 pr-2 tabular-nums">{r.invNo}</td>
              <td className="px-2">
                {r.name}
                {r.note && <span className="block text-xs text-ink-faint">💬 {r.note}</span>}
              </td>
              <td className="px-2 text-ink-soft">{r.group ?? '—'}</td>
              <td className="px-2">{r.registerRoom ?? '—'}</td>
              <td className={`px-2 ${r.status === 'moved' ? 'font-semibold text-review' : ''}`}>
                {r.actualRoom ?? '—'}
              </td>
              <td
                className={`px-2 ${r.condition === 'writeoff' ? 'text-mismatch' : r.condition === 'damaged' ? 'text-review' : ''}`}
              >
                {r.condition ? CONDITION[r.condition] : '—'}
                {r.needsLabel ? ' · 🏷' : ''}
              </td>
              <td className="pl-2 text-ink-faint">
                {r.photos || r.videos ? `${r.photos}${r.videos ? `+${r.videos}🎥` : ''}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Fixed assets result: found, moved, missing, surplus, condition and value at stake. */
export default function AssetReport({
  id,
  number,
  rows,
}: {
  id: string;
  number: string;
  rows: AssetRow[];
}) {
  const by = (s: AssetStatus) => rows.filter((r) => r.status === s);
  const missingValue = by('missing').reduce((s, r) => s + (r.value ?? 0), 0);
  const damaged = rows.filter((r) => r.condition === 'damaged').length;
  const writeoff = rows.filter((r) => r.condition === 'writeoff').length;
  const labels = rows.filter((r) => r.needsLabel).length;

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/manage/${id}`}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </Link>
        <h1 className="mt-1 text-xl font-semibold">ძირითადი საშუალებები — შედეგი</h1>
        {!rows.some((r) => r.status !== 'surplus') && (
          <p className="mt-2 text-sm text-review">
            რეესტრი არ არის ჩატვირთული —{' '}
            <Link className="underline" href={`/count/${id}/register`}>
              ჩატვირთე
            </Link>
            .
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        {(['found', 'moved', 'missing', 'surplus'] as AssetStatus[]).map((s) => (
          <div key={s} className="rounded-control border border-rule/70 p-3">
            <p className={`text-2xl font-semibold ${TONE[s]}`}>{by(s).length}</p>
            {ASSET_STATUS[s]}
          </div>
        ))}
      </div>
      <p className="text-sm text-ink-soft">
        დაზიანებული: <b>{damaged}</b> · ჩამოსაწერი: <b>{writeoff}</b> · ეტიკეტი დასაბეჭდი:{' '}
        <b>{labels}</b>
        {missingValue > 0 && (
          <>
            {' '}
            · დაკარგულის ღირებულება: <b className="text-mismatch">{money(missingValue)}</b>
          </>
        )}
      </p>

      {(() => {
        const g = new Map<string, { all: number; missing: number; found: number }>();
        for (const r of rows) {
          const k = r.group ?? 'ჯგუფის გარეშე';
          const v = g.get(k) ?? { all: 0, missing: 0, found: 0 };
          v.all += 1;
          if (r.status === 'missing') v.missing += 1;
          if (r.status === 'found' || r.status === 'moved') v.found += 1;
          g.set(k, v);
        }
        return g.size > 1 || !g.has('ჯგუფის გარეშე') ? (
          <section className="grid gap-2">
            <h2 className="font-semibold">ჯგუფების მიხედვით</h2>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[...g.entries()]
                .sort((a, b) => b[1].all - a[1].all)
                .map(([k, v]) => (
                  <div key={k} className="rounded-control border border-rule/70 p-2">
                    <p className="font-medium">{k}</p>
                    <p className="text-xs text-ink-faint">
                      სულ {v.all} · ნაპოვნი {v.found}
                      {v.missing ? (
                        <span className="text-mismatch"> · დაკარგ. {v.missing}</span>
                      ) : null}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        ) : null;
      })()}

      {by('missing').length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-mismatch">დაკარგული — რეესტრშია, ვერ იპოვეს</h2>
          <Rows rows={by('missing')} />
        </section>
      )}
      {by('moved').length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-review">გადაადგილებული — სხვა ოთახშია</h2>
          <Rows rows={by('moved')} />
        </section>
      )}
      {by('surplus').length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-mismatch">მეტობა — რეესტრში არ არის</h2>
          <Rows rows={by('surplus')} />
        </section>
      )}
      {by('found').length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-semibold text-match">ნაპოვნი</h2>
          <Rows rows={by('found')} />
        </section>
      )}
    </div>
  );
}
