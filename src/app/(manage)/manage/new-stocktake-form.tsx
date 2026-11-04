'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { currentPosition, mapsLink } from '@/lib/geo';
import { createStocktake, type FormState } from '@/app/(count)/count/actions';

const EMPTY: FormState = {};

/** The number (INV-2026-0001…) is given by the database when it is saved. */
export default function NewStocktakeForm() {
  const [state, action, pending] = useActionState(createStocktake, EMPTY);
  const [point, setPoint] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-sm font-semibold">ახალი ინვენტარიზაცია</p>
      <label className="grid gap-1 text-sm">
        თარიღი
        <input name="count_date" type="date" defaultValue={today} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        კომპანია
        <input name="client_name" required placeholder="მაგ. ექსტრა" className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        საწყობი / ფილიალი
        <input name="branch" required placeholder="მაგ. ყაზბეგის საწყობი" className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        მისამართი
        <input name="address" placeholder="მაგ. თბილისი, ყაზბეგის გამზ. 12" className={inputClass} />
      </label>

      <input type="hidden" name="lat" value={point?.lat ?? ''} />
      <input type="hidden" name="lng" value={point?.lng ?? ''} />
      <button
        type="button"
        onClick={async () => {
          setLocating('ვადგენ მდებარეობას…');
          const p = await currentPosition(12000);
          setPoint(p);
          setLocating(p ? null : 'მდებარეობა ვერ დადგინდა. დაუშვი მდებარეობა ბრაუზერში ან გამოტოვე.');
        }}
        className="rounded-control border border-rule-strong px-4 py-3 text-sm"
      >
        📍 საწყობის წერტილი — ჩემი მდებარეობა
      </button>
      {point && (
        <p className="text-sm text-match">
          ✓ <a href={mapsLink(point.lat, point.lng)} target="_blank" rel="noreferrer" className="underline">რუკაზე ნახვა</a> (±{Math.round(point.accuracy)} მ)
        </p>
      )}
      {locating && <p className="text-sm text-ink-soft">{locating}</p>}

      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? 'იხსნება…' : 'გახსნა'}
      </Button>
    </form>
  );
}
