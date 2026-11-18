'use client';

import { useState, useTransition } from 'react';
import { reopenShelf } from '../../../actions';

/** Open the closed shelf again to add a product left out or fix a count. */
export default function ReopenButton({
  stocktakeId,
  locationId,
}: {
  stocktakeId: string;
  locationId: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reopenShelf(stocktakeId, locationId);
            if (r?.error) setErr(r.error);
          })
        }
        className="rounded-control border-2 border-review px-4 py-3 text-base font-semibold text-review disabled:opacity-50"
      >
        {pending ? '…' : '➕ პროდუქტის დამატება / ჩასწორება (თაროს გახსნა)'}
      </button>
      {err && <p className="text-sm text-mismatch">{err}</p>}
    </div>
  );
}
