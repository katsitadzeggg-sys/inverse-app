'use client';

import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui';
import { cancelBookVersion } from '../../actions';

export type BookVersion = {
  id: string;
  loaded_at: string;
  who: string | null;
  file_name: string | null;
  note: string | null;
  lines: number;
  units: number;
  value: number;
  status: 'active' | 'replaced' | 'cancelled';
};

const fmt = (n: number) => Math.round(Number(n)).toLocaleString('ka-GE');
/** DD.MM, HH:MM in Tbilisi time, whatever the browser's language. */
const when = (d: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tbilisi',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(d))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}, ${p.hour}:${p.minute}`;
};
const STATUS: Record<BookVersion['status'], [string, string]> = {
  active: ['მოქმედი', 'bg-[#2fbf71]/15 text-[#1f7a4d]'],
  replaced: ['ძველი', 'bg-paper-sunk text-ink-soft'],
  cancelled: ['გაუქმებული', 'bg-[#d64545]/10 text-[#d64545]'],
};

/**
 * Every balance loaded into this stocktake, newest first. Nothing is deleted:
 * each can be downloaded, and a wrong one (another warehouse, a wrong file)
 * is cancelled — left out of missed and re-check; if it was in use, the
 * previous one comes back. Counts never change.
 */
export default function BookVersions({
  stocktakeId,
  versions,
  open,
}: {
  stocktakeId: string;
  versions: BookVersion[];
  open: boolean;
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!versions.length) return null;

  return (
    <section className="grid gap-3 rounded-2xl border border-rule/70 bg-paper-sunk/60 p-5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">ჩატვირთული ნაშთები</h2>
        <span className="text-xs text-ink-faint">არაფერი იშლება — არასწორი ნაშთი უქმდება</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-xs text-ink-faint">
            <tr>
              <th className="py-1 pr-3">როდის</th>
              <th className="px-3">ვინ</th>
              <th className="px-3">ფაილი</th>
              <th className="px-3 text-right">ხაზი</th>
              <th className="px-3 text-right">ცალი</th>
              <th className="px-3 text-right">₾</th>
              <th className="px-3">სტატუსი</th>
              <th className="pl-3" />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.id}
                className={`border-t border-rule/60 align-middle ${v.status === 'cancelled' ? 'text-ink-faint line-through decoration-[#d64545]/40' : ''}`}
              >
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{when(v.loaded_at)}</td>
                <td className="px-3">{v.who ?? '—'}</td>
                <td className="max-w-64 truncate px-3" title={v.file_name ?? v.note ?? ''}>
                  {v.file_name ?? v.note ?? '—'}
                </td>
                <td className="px-3 text-right tabular-nums">{fmt(v.lines)}</td>
                <td className="px-3 text-right tabular-nums">{fmt(v.units)}</td>
                <td className="px-3 text-right tabular-nums">{fmt(v.value)}</td>
                <td className="px-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold no-underline ${STATUS[v.status][1]}`}
                  >
                    {STATUS[v.status][0]}
                  </span>
                </td>
                <td className="whitespace-nowrap pl-3 text-right">
                  <a
                    href={`/count/${stocktakeId}/book/version/${v.id}`}
                    className="text-[#1f7a4d] underline decoration-dotted"
                  >
                    ⬇ Excel
                  </a>
                  {open && v.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => setAsk(v.id)}
                      className="ml-3 text-[#d64545] underline decoration-dotted"
                    >
                      ❌ არასწორია
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ask && (
        <div className="grid gap-2 rounded-xl border border-[#d64545]/30 bg-paper p-3">
          <p>
            ეს ნაშთი გაუქმდება: გამორჩენილსა და გადასამოწმებელში აღარ ჩაითვლება.
            {versions.find((v) => v.id === ask)?.status === 'active' &&
              ' მის ნაცვლად წინა ნაშთი დაბრუნდება (თუ იყო).'}{' '}
            დათვლილი არ შეიცვლება. ნაშთი ისტორიაში დარჩება.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg(await cancelBookVersion(stocktakeId, ask));
                  setAsk(null);
                })
              }
              className="rounded-xl bg-[#d64545] px-4 py-2 font-semibold text-white"
            >
              {pending ? '…' : 'კი, გააუქმე'}
            </button>
            <button
              type="button"
              onClick={() => setAsk(null)}
              className="rounded-xl border border-rule-strong px-4 py-2"
            >
              არა
            </button>
          </div>
        </div>
      )}
      {msg?.error && <Alert>{msg.error}</Alert>}
      {msg?.notice && <Alert tone="info">{msg.notice}</Alert>}
    </section>
  );
}
