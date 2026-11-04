'use client';

import { useActionState } from 'react';
import { inputClass } from '@/components/ui';
import { saveZoneNote, type FormState } from '../../actions';

const EMPTY: FormState = {};

/** A note for the whole shelf: damage, mixed goods, missing label… */
export default function ZoneNote({ stocktakeId, locationId, note, canEdit }: { stocktakeId: string; locationId: string; note: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveZoneNote.bind(null, stocktakeId, locationId), EMPTY);
  if (!canEdit) return note ? <p className="rounded-control border border-rule/70 p-3 text-sm">💬 {note}</p> : null;
  return (
    <details open={!!note} className="rounded-control border border-rule/70 p-3">
      <summary className="cursor-pointer text-sm font-semibold">💬 კომენტარი თაროზე{note ? '' : ' (არასავალდებულო)'}</summary>
      <form action={action} className="mt-2 grid gap-2">
        <textarea name="note" defaultValue={note} rows={3} placeholder="მაგ. ზედა იარუსი დაზიანებულია; შერეული პროდუქცია; ეტიკეტი არ აქვს" className={`${inputClass} text-base`} />
        <button type="submit" disabled={pending} className="justify-self-end rounded-control border border-rule-strong px-4 py-2 text-sm">
          {pending ? '…' : state.notice ? '✓ შენახულია' : 'შენახვა'}
        </button>
        {state.error && <p className="text-sm text-mismatch">{state.error}</p>}
      </form>
    </details>
  );
}
