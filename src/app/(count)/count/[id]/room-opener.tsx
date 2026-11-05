'use client';

import { useActionState, useEffect, useState } from 'react';
import { currentPosition } from '@/lib/geo';
import { Alert, inputClass } from '@/components/ui';
import { openZone, type FormState } from '../actions';

const EMPTY: FormState = {};

/**
 * Fixed assets: start a room by typing its name — "302", "A-302", "პირველი
 * მარჯვენა". No QR needed. A room the system does not know yet is added on
 * the spot. Rooms from the register are offered as one-tap choices.
 */
export default function RoomOpener({ stocktakeId, suggestions }: { stocktakeId: string; suggestions: string[] }) {
  const [state, action, pending] = useActionState(openZone.bind(null, stocktakeId), EMPTY);
  const [room, setRoom] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  useEffect(() => {
    currentPosition().then(setPos);
  }, []);

  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-base font-semibold">რომელ ოთახში იწყებ?</p>
      <input type="hidden" name="create" value="1" />
      <input type="hidden" name="name" value={room.trim()} />
      {pos && (
        <>
          <input type="hidden" name="lat" value={pos.lat} />
          <input type="hidden" name="lng" value={pos.lng} />
          <input type="hidden" name="acc" value={Math.round(pos.accuracy)} />
        </>
      )}
      <input
        name="code"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        required
        autoComplete="off"
        enterKeyHint="go"
        placeholder="მაგ. 302, A-302, პირველი მარჯვენა"
        className={`${inputClass} py-3 text-lg`}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRoom(s)}
              className={`rounded-control border px-3 py-1.5 text-sm ${room === s ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <button type="submit" disabled={pending || !room.trim()} className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper disabled:opacity-50">
        {pending ? '…' : '▶ აღწერის დაწყება'}
      </button>
      <p className="text-xs text-ink-faint">
        ოთახი სისტემაში თუ არ არის, ავტომატურად დაემატება. {pos ? `📍 მდებარეობა ჩაიწერება (±${Math.round(pos.accuracy)} მ).` : ''}
      </p>
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
