'use client';

import { useState, useTransition } from 'react';
import { closeCycle } from './actions';

/** "Close the quarter" with a confirmation that says what happens. */
export default function CloseCycleButton({
  cycleId,
  label,
  open,
}: {
  cycleId: string;
  label: string;
  /** Its stocktakes still open (they get closed too). */
  open: number;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="grid gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const msg =
            `დავხურო ${label}?\n\n` +
            (open ? `ღია ინვენტარიზაციები (${open}) დაიხურება.\n` : '') +
            'შედეგი ანალიტიკისთვის დაფიქსირდება. ამ საწყობის შემდეგი ინვენტარიზაცია ახალ ციკლს დაიწყებს — ახალი გამორჩენილით და გადასამოწმებლით.';
          if (!window.confirm(msg)) return;
          start(async () => {
            const r = await closeCycle(cycleId);
            setErr(r.error ?? null);
          });
        }}
        className="rounded-control border-2 border-mismatch px-3 py-2 text-sm font-semibold text-mismatch disabled:opacity-50"
      >
        {pending ? 'იხურება…' : '🔒 ციკლის დახურვა'}
      </button>
      {err && <span className="text-xs text-mismatch">{err}</span>}
    </span>
  );
}
