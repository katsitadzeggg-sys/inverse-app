'use client';

import { useState, useTransition } from 'react';
import { setStocktakeMembers } from '@/app/(count)/count/actions';

/**
 * Who may count in this stocktake. Each tick is saved at once and confirmed
 * on screen. Nobody ticked = every counter of the team sees it.
 */
export default function MembersForm({
  stocktakeId,
  counters,
  ticked,
}: {
  stocktakeId: string;
  counters: { id: string; full_name: string | null; email: string }[];
  ticked: string[];
}) {
  const [chosen, setChosen] = useState(new Set(ticked));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    start(async () => {
      const r = await setStocktakeMembers(stocktakeId, [...next]);
      setMsg(
        r.error
          ? { ok: false, text: `ვერ შეინახა: ${r.error}` }
          : { ok: true, text: '✓ შენახულია' },
      );
    });
  }

  return (
    <div className="grid gap-1.5">
      {counters.map((m) => (
        <label key={m.id} className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={chosen.has(m.id)}
            onChange={() => toggle(m.id)}
            className="h-5 w-5 accent-[#f97316]"
          />
          <span>
            {m.full_name ?? m.email} <span className="text-ink-faint">· {m.email}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-ink-faint">
        {pending ? (
          'ინახება…'
        ) : msg ? (
          <span className={msg.ok ? 'text-match' : 'text-mismatch'}>{msg.text}</span>
        ) : chosen.size ? (
          `მონიშნული ${chosen.size} — მხოლოდ ისინი დაინახავენ.`
        ) : (
          'არავინ მონიშნული — ყველა აღმწერი ხედავს.'
        )}
      </p>
    </div>
  );
}
