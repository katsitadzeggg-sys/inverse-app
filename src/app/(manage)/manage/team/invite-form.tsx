'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { inviteMember, type InviteState } from './actions';

const EMPTY: InviteState = {};

/**
 * Email + role. After saving, shows a ready message with the app link to send
 * by WhatsApp, Viber or mail: the person signs up with exactly that email and
 * lands in this company.
 */
export default function InviteForm({
  appUrl,
  company,
  isOwner,
}: {
  appUrl: string;
  company: string;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(inviteMember, EMPTY);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState('member');
  const message = state.notice
    ? `გამარჯობა! ${company}-ში დათვლაზე დაგამატე. გახსენი ${appUrl}/login, დარეგისტრირდი ამ მეილით: ${state.notice} და პირდაპირ დათვლის ეკრანზე მოხვდები.`
    : '';

  return (
    <div className="grid gap-3 rounded-control border border-rule/70 p-4">
      <form action={action} className="grid gap-3">
        <p className="text-sm font-semibold">➕ აღმწერის დამატება</p>
        <label className="grid gap-1 text-sm">
          მეილი
          <input
            name="email"
            type="email"
            required
            inputMode="email"
            autoComplete="off"
            placeholder="name@example.com"
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-sm">
          როლი
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={inputClass}
          >
            <option value="member">აღმწერი — მხოლოდ დათვლა</option>
            {isOwner && <option value="admin">მენეჯერი — მართვაც</option>}
          </select>
        </label>
        {role === 'member' && (
          <fieldset className="grid gap-1 text-sm">
            <legend className="mb-1 text-ink-soft">რისი დათვლა შეუძლია</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="modules"
                value="assets"
                defaultChecked
                className="h-4 w-4"
              />{' '}
              🏷 ძირითადი საშუალებები
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="modules"
                value="stock"
                defaultChecked
                className="h-4 w-4"
              />{' '}
              📦 მარაგები
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="modules"
                value="expiry"
                defaultChecked
                className="h-4 w-4"
              />{' '}
              ⏳ ვადიანი
            </label>
          </fieldset>
        )}
        {state.error && <Alert>{state.error}</Alert>}
        <Button type="submit" disabled={pending}>
          {pending ? 'ვინახავ…' : 'მოწვევა'}
        </Button>
      </form>

      {message && (
        <div className="grid gap-2 rounded-control bg-paper-sunk p-3 text-sm">
          <p className="font-semibold text-match">
            {state.mailed ? `✓ მოწვევა გაიგზავნა მეილზე: ${state.notice}` : '✓ მოწვევა შენახულია'}
          </p>
          <p className="text-ink-soft">
            {state.mailed ? 'სურვილისამებრ, ესეც გაუგზავნე:' : 'გაუგზავნე ეს ტექსტი:'}
          </p>
          <p className="select-all rounded-control border border-rule/70 p-2">{message}</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded-control border border-rule-strong px-3 py-2"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? '✓ დაკოპირდა' : '📋 კოპირება'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-control border border-rule-strong px-3 py-2 text-center"
            >
              WhatsApp
            </a>
            {/* Opens the manager's own mail app with the letter ready to send. */}
            <a
              href={`mailto:${state.notice}?subject=${encodeURIComponent(`მოწვევა — ${company}`)}&body=${encodeURIComponent(message)}`}
              className="rounded-control border border-rule-strong px-3 py-2 text-center"
            >
              ✉ მეილი
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
