'use client';

import { useState } from 'react';
import type { Location } from '@/types/database';
import { setStockLevel } from './actions';

type Level = { location_id: string; quantity: number };

/** Per-location quantities, editable inline by anyone who is not a viewer. */
export default function StockCell({
  productId,
  locations,
  levels,
  canWrite,
}: {
  productId: string;
  locations: Location[];
  levels: Level[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const byId = new Map(locations.map((location) => [location.id, location]));
  const unused = locations.filter(
    (location) => !levels.some((level) => level.location_id === location.id),
  );

  if (levels.length === 0 && !canWrite) {
    return <span className="text-xs text-ink-faint">Not placed</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {levels.map((level) => {
        const location = byId.get(level.location_id);
        return (
          <form
            key={level.location_id}
            action={setStockLevel}
            className="flex items-center gap-1 rounded-control border border-rule bg-paper-sunk px-2 py-1"
          >
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="location_id" value={level.location_id} />
            <span className="font-mono text-xs text-ink-faint">
              {location?.code ?? 'unknown'}
            </span>
            <input
              name="quantity"
              type="number"
              min={0}
              defaultValue={level.quantity}
              disabled={!canWrite}
              aria-label={`Quantity at ${location?.code ?? 'location'}`}
              className="w-14 bg-transparent text-right text-xs tabular-nums text-ink focus:outline-none disabled:text-ink-faint"
            />
            {canWrite && (
              <button
                type="submit"
                className="text-xs text-ink transition hover:text-ink"
              >
                save
              </button>
            )}
          </form>
        );
      })}

      {canWrite && unused.length > 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-control border border-dashed border-rule-strong px-2 py-1 text-xs text-ink-faint transition hover:border-ink-faint hover:text-ink"
        >
          + location
        </button>
      )}

      {canWrite && adding && (
        <form
          action={setStockLevel}
          onSubmit={() => setAdding(false)}
          className="flex items-center gap-1 rounded-control border border-rule-strong bg-paper-sunk px-2 py-1"
        >
          <input type="hidden" name="product_id" value={productId} />
          <select
            name="location_id"
            aria-label="Location"
            className="bg-transparent text-xs text-ink focus:outline-none"
          >
            {unused.map((location) => (
              <option key={location.id} value={location.id} className="bg-paper-sunk">
                {location.code}
              </option>
            ))}
          </select>
          <input
            name="quantity"
            type="number"
            min={0}
            defaultValue={0}
            aria-label="Quantity"
            className="w-14 bg-transparent text-right text-xs tabular-nums focus:outline-none"
          />
          <button type="submit" className="text-xs text-ink hover:text-ink">
            add
          </button>
        </form>
      )}
    </div>
  );
}
