'use client';

import { useState, useTransition } from 'react';
import { deleteSite } from './actions';

/**
 * Delete a warehouse: asks "are you sure?" first; refused, with the reason,
 * while it still has stocktakes.
 */
export default function DeleteSite({ id, name }: { id: string; name: string }) {
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  if (msg?.error)
    return (
      <span className="flex h-full items-center gap-2 text-xs text-mismatch" title={msg.error}>
        <span className="truncate">{msg.error}</span>
        <button type="button" onClick={() => setMsg(null)} className="text-ink-faint underline">
          OK
        </button>
      </span>
    );
  if (ask)
    return (
      <span className="flex h-full items-center gap-2 text-xs">
        <span className="truncate">წავშალო „{name}“?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(await deleteSite(id));
              setAsk(false);
            })
          }
          className="rounded-full bg-[#d64545] px-2.5 py-1 font-semibold text-white"
        >
          {pending ? '…' : 'კი'}
        </button>
        <button type="button" onClick={() => setAsk(false)} className="underline">
          არა
        </button>
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => setAsk(true)}
      className="rounded-full px-2.5 py-1 text-xs font-medium text-[#d64545] hover:bg-[#d64545]/5"
    >
      🗑 წაშლა
    </button>
  );
}
