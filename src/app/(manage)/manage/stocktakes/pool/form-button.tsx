'use client';

import { useState, useTransition } from 'react';
import { openPoolForm } from '../actions';

/** Makes the form to count these products (once; afterwards the same one opens). */
export default function FormButton({ ids, kind }: { ids: string[]; kind: 'missed' | 'review' }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('შეიქმნება ახალი ინვენტარიზაცია ამ პროდუქტების დასათვლელად. გავაგრძელო?'))
            return;
          start(async () => {
            const r = await openPoolForm(ids, kind);
            if (r?.error) setErr(r.error);
          });
        }}
        className="rounded-full bg-[#1f7a4d] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'იქმნება…' : '📋 ფორმის შექმნა დასათვლელად'}
      </button>
      {err && <span className="text-xs text-[#d64545]">{err}</span>}
    </span>
  );
}
