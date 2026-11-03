'use client';

import { useActionState } from 'react';
import { createCompany, type OnboardingState } from './actions';
import { Alert, Button, Field, inputClass } from '@/components/ui';

const EMPTY: OnboardingState = {};

export default function OnboardingForm() {
  const [state, action, pending] = useActionState(createCompany, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <Field label="Company name">
        <input
          name="company_name"
          required
          autoFocus
          placeholder="Novora"
          className={inputClass}
        />
      </Field>
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
