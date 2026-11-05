'use client';

import { useActionState } from 'react';
import { inputClass } from '@/components/ui';
import { saveZoneNote, type FormState } from '../../../actions';

const EMPTY: FormState = {};

/** The free comment, saved with either button. */
export default function ShelfSummaryForm({ stocktakeId, locationId, note, rooms = false }: { stocktakeId: string; locationId: string; note: string; rooms?: boolean }) {
  const [state, action, pending] = useActionState(saveZoneNote.bind(null, stocktakeId, locationId), EMPTY);
  return (
    <form action={action} className="grid gap-3">
      <textarea name="note" defaultValue={note} rows={4} placeholder="კომენტარი" className={`${inputClass} text-base`} />
      {state.error && <p className="text-sm text-mismatch">{state.error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="submit" name="next" value="close" disabled={pending} className="rounded-control border border-rule-strong px-4 py-4 text-base font-semibold">
          დახურვა
        </button>
        <button type="submit" name="next" value="new" disabled={pending} className="rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper">
          {rooms ? 'ახალი ოთახი →' : 'ახალი თარო →'}
        </button>
      </div>
    </form>
  );
}
