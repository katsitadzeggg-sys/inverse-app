'use client';

import { useTransition } from 'react';
import { PERIODS } from '@/lib/cycles';
import type { CyclePeriod } from '@/types/database';
import { setCyclePeriod } from './actions';

/** "We count: monthly / quarterly / …" — names the cycles; saved on change. */
export default function PeriodSelect({ value }: { value: CyclePeriod }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      აღწერა:
      <select
        defaultValue={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            await setCyclePeriod(v);
          });
        }}
        className="rounded-control border border-rule-strong bg-paper px-2 py-1.5 text-ink"
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
