'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { invite, type PlatformState } from '../actions';

const EMPTY: PlatformState = {};
export const MODULE_LABEL: Record<string, string> = {
  assets: '🏷 ძირითადი საშუალებები',
  stock: '📦 მარაგები',
  expiry: '⏳ ვადიანი',
};

export default function InviteForm({
  companyId,
  companyName,
  appUrl,
}: {
  companyId: string;
  companyName: string;
  appUrl: string;
}) {
  const [state, action, pending] = useActionState(invite.bind(null, companyId), EMPTY);
  const [role, setRole] = useState('member');
  const message = state.notice
    ? `გამარჯობა! ${companyName}-ის ანგარიში Inverse-ში მზადაა. გახსენი ${appUrl}/login, დარეგისტრირდი ამ მეილით: ${state.notice}.`
    : '';
  return (
    <form
      action={action}
      className="grid content-start gap-3 rounded-control border border-rule/70 p-4"
    >
      <p className="font-semibold">➕ ადამიანის დამატება</p>
      <input name="email" type="email" required placeholder="მეილი" className={inputClass} />
      <select
        name="role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className={inputClass}
      >
        <option value="member">აღწერის თანამშრომელი — მხოლოდ დათვლა ობიექტზე</option>
        <option value="admin">მენეჯერი — ნაშთი, ინვენტარიზაცია, გუნდი</option>
      </select>
      {role === 'member' && (
        <fieldset className="grid gap-1 text-sm">
          <legend className="mb-1 text-ink-soft">რისი დათვლა შეუძლია</legend>
          {Object.entries(MODULE_LABEL).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="modules"
                value={k}
                defaultChecked={k === 'assets'}
                className="h-4 w-4"
              />{' '}
              {v}
            </label>
          ))}
        </fieldset>
      )}
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? 'ვინახავ…' : 'მოწვევა'}
      </Button>
      {message && (
        <div className="grid gap-1 rounded-control bg-paper-sunk p-3 text-sm">
          <p className="font-semibold text-match">✓ მოწვევა შენახულია. გაუგზავნე:</p>
          <p className="select-all rounded-control border border-rule/70 p-2">{message}</p>
        </div>
      )}
    </form>
  );
}
