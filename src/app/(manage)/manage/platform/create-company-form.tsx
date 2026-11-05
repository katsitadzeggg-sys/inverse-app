'use client';

import { useActionState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { createCompany, type PlatformState } from './actions';

const EMPTY: PlatformState = {};

export default function CreateCompanyForm() {
  const [state, action, pending] = useActionState(createCompany, EMPTY);
  return (
    <form action={action} className="grid content-start gap-3 rounded-control border border-rule/70 p-4">
      <p className="font-semibold">➕ ახალი კომპანია</p>
      <label className="grid gap-1 text-sm">
        კომპანიის სახელი
        <input name="name" required placeholder="მაგ. შპს ექსტრა" className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm">
        მენეჯერის მეილი
        <input name="email" type="email" required placeholder="manager@company.ge" className={inputClass} />
      </label>
      <p className="text-xs text-ink-faint">მენეჯერი დარეგისტრირდება ამ მეილით და პირდაპირ თავის კომპანიაში მოხვდება: ტვირთავს ნაშთს, ხსნის ინვენტარიზაციას, იწვევს აღმწერებს.</p>
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>{pending ? 'ვქმნი…' : 'კომპანიის შექმნა'}</Button>
    </form>
  );
}
