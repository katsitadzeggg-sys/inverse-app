'use client';

import { useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, signUp, type AuthState } from './actions';

const EMPTY: AuthState = {};

const FIELD =
  'mt-1.5 w-full rounded-control border border-rule-strong bg-transparent px-3 py-2 text-sm transition focus:border-ink focus:outline-none';

export default function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';
  const linkError = searchParams.get('error');

  const [state, action, pending] = useActionState(
    mode === 'signin' ? signIn : signUp,
    EMPTY,
  );

  return (
    <div>
      <div className="flex items-baseline gap-6 border-b border-ink pb-3">
        {(['signin', 'signup'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-current={mode === value ? 'true' : undefined}
            className={`text-sm transition ${
              mode === value
                ? 'text-ink underline underline-offset-4'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            {value === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form action={action} className="mt-8 space-y-6">
        <input type="hidden" name="next" value={next} />

        {mode === 'signup' && (
          <label className="block">
            <span className="label">Full name</span>
            <input name="full_name" autoComplete="name" className={FIELD} />
          </label>
        )}

        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" required autoComplete="email" className={FIELD} />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className={FIELD}
          />
          {mode === 'signup' && (
            <span className="mt-2 block text-xs text-ink-faint">
              At least 8 characters.
            </span>
          )}
        </label>

        {(state.error || linkError) && (
          <p className="text-sm text-mismatch">{state.error ?? linkError}</p>
        )}
        {state.notice && <p className="text-sm text-ink-soft">{state.notice}</p>}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-solid w-full disabled:opacity-50"
        >
          {pending ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
