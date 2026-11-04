'use client';

import { useActionState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { createStocktake, type FormState } from './actions';

const EMPTY: FormState = {};

/** The number (INV-2026-0001…) is given by the database when it is saved. */
export default function NewStocktakeForm() {
  const [state, action, pending] = useActionState(createStocktake, EMPTY);
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
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? 'იხსნება…' : 'გახსნა'}
      </Button>
    </form>
  );
}
