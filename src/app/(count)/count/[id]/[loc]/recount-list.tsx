'use client';

import { useActionState } from 'react';
import { inputClass } from '@/components/ui';
import { recountItem, type FormState } from '../../actions';

type Item = { product_id: string; name: string; sku: string; status: 'recount' | 'frozen'; attempts: number };

const EMPTY: FormState = {};

function RecountRow({ stocktakeId, locationId, item }: { stocktakeId: string; locationId: string; item: Item }) {
  const [state, action, pending] = useActionState(recountItem.bind(null, stocktakeId, locationId, item.product_id), EMPTY);
  const left = 3 - item.attempts;
  return (
    <li className="grid gap-2 border-b border-rule/60 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{item.name}</p>
        <span className="shrink-0 text-xs text-ink-faint">{item.sku}</span>
      </div>
      {item.status === 'frozen' ? (
        <p className="text-sm text-ink-faint">🔒 გაყინულია — გადავიდა გადასამოწმებელში</p>
      ) : (
        <form action={action} className="flex items-center gap-2">
          <input name="qty" inputMode="decimal" required placeholder="ხელახლა დათვლილი" className={`${inputClass} text-base`} />
          <button type="submit" disabled={pending} className="shrink-0 rounded-control border border-rule-strong px-3 py-2">
            {state.notice ? '✓' : pending ? '…' : 'ჩაწერა'}
          </button>
        </form>
      )}
      {item.status === 'recount' && (
        <p className="text-xs text-review">
          {left === 3 ? 'ხელახლა დათვალე' : `დარჩა ${left} ცდა`}
          {state.error && <span className="text-mismatch"> · {state.error}</span>}
        </p>
      )}
    </li>
  );
}

/** The items the book check sent back. No book numbers are shown. */
export default function RecountList({ stocktakeId, locationId, items }: { stocktakeId: string; locationId: string; items: Item[] }) {
  const due = items.filter((i) => i.status === 'recount').length;
  return (
    <section className="grid gap-1 rounded-control border-2 border-mismatch/50 bg-mismatch/5 p-4">
      <p className="text-base font-semibold text-mismatch">⚠ ხელახლა დასათვლელი: {due}</p>
      <p className="text-sm text-ink-soft">
        ეს პოზიციები არ ემთხვევა. დათვალე თავიდან, ჩაწერე და ქვემოთ დააჭირე „შემოწმება“. სამი ცდის შემდეგ პოზიცია იყინება.
      </p>
      <ul>
        {items.map((i) => (
          <RecountRow key={i.product_id} stocktakeId={stocktakeId} locationId={locationId} item={i} />
        ))}
      </ul>
    </section>
  );
}
