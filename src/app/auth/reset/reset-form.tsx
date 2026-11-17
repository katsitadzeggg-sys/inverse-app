'use client';

import { useActionState } from 'react';
import PasswordInput from '@/components/password-input';
import { setNewPassword, type AuthState } from '@/app/login/actions';

const FIELD =
  'mt-1.5 w-full rounded-control border border-rule-strong bg-transparent px-3 py-2 text-sm transition focus:border-ink focus:outline-none';

export default function ResetForm() {
  const [state, action, pending] = useActionState(setNewPassword, {} as AuthState);
  return (
    <form action={action} className="mt-8 space-y-6">
      <label className="block">
        <span className="label">ახალი პაროლი</span>
        <PasswordInput name="password" required autoComplete="new-password" className={FIELD} />
        <span className="mt-2 block text-xs text-ink-faint">მინიმუმ 8 სიმბოლო.</span>
      </label>
      <label className="block">
        <span className="label">გაიმეორე პაროლი</span>
        <PasswordInput name="password2" required autoComplete="new-password" className={FIELD} />
      </label>
      {state.error && <p className="text-sm text-mismatch">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-solid w-full disabled:opacity-50">
        {pending ? 'მიმდინარეობს…' : 'პაროლის შენახვა'}
      </button>
    </form>
  );
}
