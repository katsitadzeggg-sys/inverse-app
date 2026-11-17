'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import MapPicker from '@/components/map-picker';
import { addSite } from './actions';
import type { FormState } from '@/app/(count)/count/actions';

const EMPTY: FormState = {};

/** Add one site, with its map point and address. */
export default function SiteForms() {
  const [state, action, pending] = useActionState(addSite, EMPTY);
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="grid content-start gap-4">
      <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
        <p className="font-semibold">➕ საწყობი / ობიექტი</p>
        <input
          name="name"
          required
          placeholder="სახელი, მაგ. ყაზბეგის საწყობი"
          className={inputClass}
        />
        <input
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="მისამართი"
          className={inputClass}
        />
        <input type="hidden" name="lat" value={point?.lat ?? ''} />
        <input type="hidden" name="lng" value={point?.lng ?? ''} />
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="rounded-control border border-rule-strong px-3 py-2 text-sm"
        >
          📍 ლოკაცია რუკაზე — მისამართი ავტომატურად
        </button>
        {mapOpen && (
          <MapPicker
            start={point}
            onClose={() => setMapOpen(false)}
            onPick={(p, a) => {
              setPoint(p);
              if (a) setAddress(a);
              setLocating(a ? null : 'წერტილი ჩაიწერა, მისამართი ჩაწერე ხელით.');
              setMapOpen(false);
            }}
          />
        )}
        {point && <p className="text-xs text-match">✓ წერტილი ჩაიწერა</p>}
        {locating && <p className="text-xs text-ink-soft">{locating}</p>}
        {state.error && <Alert>{state.error}</Alert>}
        {state.notice && <Alert tone="info">{state.notice}</Alert>}
        <Button type="submit" disabled={pending}>
          {pending ? '…' : 'დამატება'}
        </Button>
      </form>
    </div>
  );
}
