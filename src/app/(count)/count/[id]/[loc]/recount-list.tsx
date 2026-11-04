'use client';

import { useActionState } from 'react';
import { inputClass } from '@/components/ui';
import { recountItem, type FormState } from '../../actions';

type Item = { product_id: string; name: string; code: string };

const EMPTY: FormState = {};

function Row({ stocktakeId, locationId, shelf, item }: { stocktakeId: string; locationId: string; shelf: string; item: Item }) {
  const [state, action, pending] = useActionState(recountItem.bind(null, stocktakeId, locationId, item.product_id), EMPTY);
  return (
    <li className="grid gap-2 border-b border-rule/60 py-3">
      <div>
        <p className="font-medium">{item.name}</p>
        <p className="text-xs text-ink-faint">{shelf} · {item.code}</p>
      </div>
      <form action={action} className="flex items-center gap-2">
        <input name="qty" inputMode="decimal" required placeholder="რაოდენობა" className={`${inputClass} text-base`} />
        <button type="submit" disabled={pending} className={`shrink-0 rounded-control border px-3 py-2 ${state.notice ? 'border-match text-match' : 'border-rule-strong'}`}>
          {pending ? '…' : state.notice ? '✓' : 'დადასტურება'}
        </button>
      </form>
      {state.error && <p className="text-xs text-mismatch">{state.error}</p>}
    </li>
  );
}

/** The items that differ from the book. No book numbers are shown. */
export default function RecountList({ stocktakeId, locationId, shelf, items }: { stocktakeId: string; locationId: string; shelf: string; items: Item[] }) {
  return (
    <section className="grid gap-1 rounded-control border-2 border-mismatch/50 bg-mismatch/5 p-4">
      <p className="text-base font-semibold text-mismatch">გადასათვლელი: {items.length}</p>
      <ul>
        {items.map((i) => (
          <Row key={i.product_id} stocktakeId={stocktakeId} locationId={locationId} shelf={shelf} item={i} />
        ))}
      </ul>
    </section>
  );
}
