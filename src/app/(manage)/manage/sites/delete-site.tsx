'use client';

import { useState, useTransition } from 'react';
import { deleteSite } from './actions';

/** Delete a warehouse — refused, with the reason, while it still has stocktakes. */
export default function DeleteSite({ id }: { id: string }) {
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid justify-items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setMsg(await deleteSite(id)))}
        className="text-xs text-ink-faint underline"
      >
        {pending ? '…' : 'წაშლა'}
      </button>
      {msg?.error && <p className="max-w-56 text-right text-xs text-mismatch">{msg.error}</p>}
    </div>
  );
}
