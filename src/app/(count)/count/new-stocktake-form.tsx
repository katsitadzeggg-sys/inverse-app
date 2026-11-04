'use client';

import { useActionState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { createStocktake, type FormState } from './actions';

const EMPTY: FormState = {};

export default function NewStocktakeForm() {
  const [state, action, pending] = useActionState(createStocktake, EMPTY);
  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-sm font-semibold">ახალი ინვენტარიზაცია</p>
      <input name="name" required placeholder="მაგ. ექსტრა — საწყობი, ნოემბერი" className={inputClass} />
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? 'იხსნება…' : 'გახსნა'}
      </Button>
    </form>
  );
}
