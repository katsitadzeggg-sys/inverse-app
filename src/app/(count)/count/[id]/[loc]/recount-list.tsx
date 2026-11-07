'use client';

import { useActionState, useState } from 'react';
import { inputClass } from '@/components/ui';
import { recountAll, recountItem, type FormState } from '../../actions';

type Item = { product_id: string; name: string; code: string };

const EMPTY: FormState = {};

function Row({
  stocktakeId,
  locationId,
  shelf,
  item,
  expiry,
}: {
  stocktakeId: string;
  locationId: string;
  shelf: string;
  item: Item;
  expiry: boolean;
}) {
  const [state, action, pending] = useActionState(
    recountItem.bind(null, stocktakeId, locationId, item.product_id),
    EMPTY,
  );
  // Expiry-date count: the recount is entered per batch again.
  const [batches, setBatches] = useState([{ qty: '', expiry: '' }]);
  const set = (i: number, k: 'qty' | 'expiry', v: string) =>
    setBatches((b) => b.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <li className="grid gap-2 border-b border-rule/60 py-3">
      <div>
        <p className="font-medium">{item.name}</p>
        <p className="text-xs text-ink-faint">
          {shelf} · {item.code}
        </p>
      </div>
      {expiry ? (
        <form action={action} className="grid gap-2">
          <input
            type="hidden"
            name="batches"
            value={JSON.stringify(
              batches
                .filter((b) => b.qty !== '')
                .map((b) => ({ qty: Number(b.qty), expiry: b.expiry || null })),
            )}
          />
          {batches.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="date"
                value={b.expiry}
                onChange={(e) => set(i, 'expiry', e.target.value)}
                aria-label="ვადა"
                className={`${inputClass} text-base`}
              />
              <input
                value={b.qty}
                onChange={(e) => set(i, 'qty', e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="რაოდ."
                className={`${inputClass} w-24 text-base`}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setBatches((b) => [...b, { qty: '', expiry: '' }])}
              className="text-sm text-ink-soft underline"
            >
              + კიდევ ვადა
            </button>
            <button
              type="submit"
              disabled={pending || !batches.some((b) => b.qty !== '')}
              className={`shrink-0 rounded-control border px-3 py-2 ${state.notice ? 'border-match text-match' : 'border-rule-strong'}`}
            >
              {pending ? '…' : state.notice ? '✓' : 'დადასტურება'}
            </button>
          </div>
        </form>
      ) : (
        <form action={action} className="flex items-center gap-2">
          <input
            name="qty"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            placeholder="რაოდენობა"
            className={`${inputClass} text-base`}
          />
          <button
            type="submit"
            disabled={pending}
            className={`shrink-0 rounded-control border px-3 py-2 ${state.notice ? 'border-match text-match' : 'border-rule-strong'}`}
          >
            {pending ? '…' : state.notice ? '✓' : 'დადასტურება'}
          </button>
        </form>
      )}
      {state.error && <p className="text-xs text-mismatch">{state.error}</p>}
    </li>
  );
}

/**
 * The items that differ from the book. No book numbers are shown.
 * Stock: one quantity field per item and one button that saves them all and
 * checks the shelf again (no separate confirm per row to forget).
 */
export default function RecountList({
  stocktakeId,
  locationId,
  shelf,
  items,
  expiry = false,
}: {
  stocktakeId: string;
  locationId: string;
  shelf: string;
  items: Item[];
  expiry?: boolean;
}) {
  const [state, action, pending] = useActionState(
    recountAll.bind(null, stocktakeId, locationId),
    EMPTY,
  );
  if (expiry)
    return (
      <section className="grid gap-1 rounded-control border-2 border-mismatch/50 bg-mismatch/5 p-4">
        <p className="text-base font-semibold text-mismatch">გადასათვლელი: {items.length}</p>
        <ul>
          {items.map((i) => (
            <Row
              key={i.product_id}
              stocktakeId={stocktakeId}
              locationId={locationId}
              shelf={shelf}
              item={i}
              expiry
            />
          ))}
        </ul>
      </section>
    );
  return (
    <form
      action={action}
      className="grid gap-3 rounded-control border-2 border-mismatch/50 bg-mismatch/5 p-4"
    >
      <p className="text-lg font-semibold text-mismatch">გადათვალე: {items.length}</p>
      <ul className="grid gap-3">
        {items.map((i) => (
          <li key={i.product_id} className="grid gap-1.5">
            <p className="text-base font-medium leading-tight">
              {i.name} <span className="text-xs text-ink-faint">{i.code}</span>
            </p>
            <input
              name={`qty:${i.product_id}`}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="რაოდენობა"
              className={`${inputClass} py-4 text-center text-2xl font-semibold`}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-faint">ცარიელი ველი = არ არის თაროზე (0).</p>
      {state.error && <p className="text-sm text-mismatch">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-control bg-match px-4 py-5 text-xl font-semibold text-white disabled:opacity-60"
      >
        {pending ? '…' : '✓ დადასტურება'}
      </button>
    </form>
  );
}
