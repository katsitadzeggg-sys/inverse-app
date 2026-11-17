'use client';

import { useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PasswordInput from '@/components/password-input';
import { requestReset, signIn, signUp, type AuthState } from './actions';

const EMPTY: AuthState = {};

const FIELD =
  'mt-1.5 w-full rounded-control border border-rule-strong bg-transparent px-3 py-2 text-sm transition focus:border-ink focus:outline-none';

type Mode = 'signin' | 'signup' | 'reset';
const ACTION = { signin: signIn, signup: signUp, reset: requestReset };
const BUTTON = { signin: 'შესვლა', signup: 'რეგისტრაცია', reset: 'ბმულის გაგზავნა' };

/**
 * Sign in, sign up and "forgot password". The fields carry the names and
 * autocomplete hints browsers and password managers look for, so the
 * password is offered for saving and filled in next time.
 */
export default function LoginForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/count';
  const linkError = searchParams.get('error');

  // One form per mode: switching starts a fresh form state.
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
            {value === 'signin' ? 'შესვლა' : 'რეგისტრაცია'}
          </button>
        ))}
      </div>
      <Form key={mode} mode={mode} setMode={setMode} next={next} linkError={linkError} />
    </div>
  );
}

function Form({
  mode,
  setMode,
  next,
  linkError,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  next: string;
  linkError: string | null;
}) {
  const [state, action, pending] = useActionState(ACTION[mode], EMPTY);
  return (
    <form action={action} className="mt-8 space-y-6">
      <input type="hidden" name="next" value={next} />

      {mode === 'reset' && (
        <p className="text-sm text-ink-soft">
          ჩაწერე შენი ელფოსტა — გამოგიგზავნით ბმულს ახალი პაროლის დასაყენებლად.
        </p>
      )}

      {mode === 'signup' && (
        <>
          <label className="block">
            <span className="label">სახელი და გვარი</span>
            <input name="full_name" autoComplete="name" className={FIELD} />
          </label>
          <label className="block">
            <span className="label">კომპანია</span>
            <input name="company_name" required autoComplete="organization" className={FIELD} />
          </label>
        </>
      )}

      <label className="block">
        <span className="label">ელფოსტა</span>
        <input
          name="email"
          type="email"
          required
          autoComplete={mode === 'signin' ? 'username' : 'email'}
          className={FIELD}
        />
      </label>

      {mode !== 'reset' && (
        <label className="block">
          <span className="label">პაროლი</span>
          <PasswordInput
            name="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className={FIELD}
          />
          {mode === 'signup' && (
            <span className="mt-2 block text-xs text-ink-faint">მინიმუმ 8 სიმბოლო.</span>
          )}
        </label>
      )}

      {mode === 'signup' && (
        <label className="block">
          <span className="label">გაიმეორე პაროლი</span>
          <PasswordInput name="password2" required autoComplete="new-password" className={FIELD} />
        </label>
      )}

      {(state.error || linkError) && (
        <p className="text-sm text-mismatch">{state.error ?? linkError}</p>
      )}
      {state.notice && <p className="text-sm text-ink-soft">{state.notice}</p>}

      <button type="submit" disabled={pending} className="btn btn-solid w-full disabled:opacity-50">
        {pending ? 'მიმდინარეობს…' : BUTTON[mode]}
      </button>

      {mode === 'signin' && (
        <button
          type="button"
          onClick={() => setMode('reset')}
          className="block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          პაროლი დაგავიწყდა?
        </button>
      )}
      {mode === 'reset' && (
        <button
          type="button"
          onClick={() => setMode('signin')}
          className="block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          ← შესვლაზე დაბრუნება
        </button>
      )}
    </form>
  );
}
