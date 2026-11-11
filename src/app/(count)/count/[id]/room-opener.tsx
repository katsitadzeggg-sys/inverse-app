'use client';

import { useActionState, useEffect, useState } from 'react';
import { currentPosition } from '@/lib/geo';
import { Alert } from '@/components/ui';
import LocationStatus from '@/components/location-status';
import { openZone, type FormState } from '../actions';

const EMPTY: FormState = {};

/**
 * Fixed assets: start a room by typing its name — "302", "A-302", "პირველი
 * მარჯვენა". No QR needed. A room the system does not know yet is added on
 * the spot. Rooms from the register are offered as one-tap choices.
 */
export default function RoomOpener({
  stocktakeId,
  suggestions,
  close,
}: {
  stocktakeId: string;
  suggestions: string[];
  /** On a room page: this room is closed when the next one opens. */
  close?: string;
}) {
  const [state, action, pending] = useActionState(openZone.bind(null, stocktakeId), EMPTY);
  const [room, setRoom] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null | undefined>(
    undefined,
  );
  useEffect(() => {
    currentPosition().then(setPos);
  }, []);

  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      <input type="hidden" name="create" value="1" />
      {close && <input type="hidden" name="close" value={close} />}
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
        autoFocus={!close}
        placeholder={close ? 'შემდეგი ოთახი' : 'ოთახი: 302, A-302, პირველი მარჯვენა'}
        className="w-full rounded-control border-2 border-white bg-white px-4 py-4 text-xl text-black caret-black placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-match/40"
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
      <button
        type="submit"
        disabled={pending || !room.trim()}
        className="rounded-control bg-match px-4 py-4 text-xl font-semibold text-white disabled:opacity-50"
      >
        {pending ? '…' : close ? '▶ შემდეგი ოთახი' : '▶ აღწერის დაწყება'}
      </button>
      {/* Only a problem is worth a line: location switched off. */}
      {pos === null && (
        <LocationStatus pos={pos} onRetry={async () => setPos(await currentPosition(8000))} />
      )}
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
