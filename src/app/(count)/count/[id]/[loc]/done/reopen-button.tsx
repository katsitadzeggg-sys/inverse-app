'use client';

import { useState, useTransition } from 'react';
import { reopenShelf } from '../../../actions';

/** Open the closed shelf again to add a product left out or fix a count. */
export default function ReopenButton({
  stocktakeId,
  locationId,
  back,
}: {
  stocktakeId: string;
  locationId: string;
  /** Manager's page: stay there after sending the shelf back. */
  back?: string;
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
            const r = await reopenShelf(stocktakeId, locationId, back);
            if (r?.error) setErr(r.error);
          })
        }
        className={
          back
            ? 'w-fit rounded-full border border-review px-4 py-2 text-sm font-semibold text-review disabled:opacity-50'
            : 'rounded-control border-2 border-review px-4 py-3 text-base font-semibold text-review disabled:opacity-50'
        }
      >
        {pending
          ? '…'
          : back
            ? '↩ თაროს დაბრუნება გადასათვლელად'
            : '➕ პროდუქტის დამატება / ჩასწორება (თაროს გახსნა)'}
      </button>
      {err && <p className="text-sm text-mismatch">{err}</p>}
    </div>
  );
}
