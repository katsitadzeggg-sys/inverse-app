'use client';

import { startTransition, useActionState, useEffect, useState, useTransition } from 'react';
import { currentPosition } from '@/lib/geo';
import { normKey } from '@/lib/text';
import { Alert } from '@/components/ui';
import ComboInput from '@/components/combo-input';
import Scanner from '../scanner';
import { matchShelf, openZone, type FormState } from '../actions';

const EMPTY: FormState = {};

/**
 * Stock count, step 1: which shelf. Scan its QR, or type it — typing "T"
 * drops down the shelves that match. A shelf that is not on the list is added
 * after a yes.
 */
export default function ZoneOpener({ stocktakeId, shelves }: { stocktakeId: string; shelves: string[] }) {
  const [state, action, pending] = useActionState(openZone.bind(null, stocktakeId), EMPTY);
  const [typed, setTyped] = useState('');
  const [ask, setAsk] = useState<string | null>(null); // "add this shelf?"
  const [busy, start] = useTransition();
  // The phone's position goes with the shelf when it is opened.
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  useEffect(() => {
    currentPosition().then(setPos);
  }, []);

  function open(code: string, create = false) {
    const fd = new FormData();
    fd.set('code', code);
    if (create) {
      fd.set('create', '1');
      fd.set('name', code);
    }
    if (pos) {
      fd.set('lat', String(pos.lat));
      fd.set('lng', String(pos.lng));
      fd.set('acc', String(Math.round(pos.accuracy)));
    }
    startTransition(() => action(fd));
  }

  function go(text: string) {
    const code = text.trim();
    if (!code) return;
    setAsk(null);
    const known = shelves.find((s) => normKey(s) === normKey(code));
    if (known) return open(known);
    start(async () => {
      const shelf = await matchShelf(code);
      if (shelf) open(shelf.code);
      else {
        setTyped(code);
        setAsk(code);
      }
    });
  }

  return (
    <section className="grid gap-4">
      <Scanner label="თაროს QR" onCode={go} variant="big" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(typed);
        }}
        className="grid gap-3"
      >
        <ComboInput
          value={typed}
          onChange={(v) => {
            setTyped(v);
            setAsk(null);
          }}
          options={shelves}
          placeholder="თარო, მაგ. T-01"
          className="w-full rounded-control border-2 border-white bg-white px-4 py-5 text-xl text-black caret-black placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-match/40"
        />
        {!ask && (
          <button type="submit" disabled={!typed.trim() || busy || pending} className="rounded-control bg-match px-4 py-5 text-2xl font-semibold text-white disabled:opacity-50">
            {busy || pending ? '…' : 'OK'}
          </button>
        )}
      </form>

      {ask && (
        <div className="grid gap-3 rounded-control border-2 border-review p-4">
          <p className="text-center text-lg">
            თარო <b className="text-2xl">{ask}</b> სიაში არ არის.
            <br />
            დავამატო?
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setAsk(null)} className="rounded-control border-2 border-rule-strong py-4 text-lg font-semibold">
              არა
            </button>
            <button type="button" disabled={pending} onClick={() => open(ask, true)} className="rounded-control bg-match py-4 text-lg font-semibold text-white disabled:opacity-50">
              ✓ დამატება
            </button>
          </div>
        </div>
      )}

      {state.error && <Alert>{state.error}</Alert>}
    </section>
  );
}
