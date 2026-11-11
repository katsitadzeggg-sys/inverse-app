'use client';

import { useState } from 'react';

type Pos = { lat: number; lng: number; accuracy: number } | null;

/**
 * Always-visible line about the phone's location: recorded (with accuracy),
 * still looking, or off — with a retry button and where to switch it on.
 */
export default function LocationStatus({
  pos,
  onRetry,
}: {
  pos: Pos | undefined;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  if (pos === undefined) return <p className="text-xs text-ink-soft">📍 ვადგენ მდებარეობას…</p>;
  if (pos)
    return (
      <p className="text-xs text-match">📍 მდებარეობა ჩაიწერება (±{Math.round(pos.accuracy)} მ)</p>
    );
  return (
    <div className="grid gap-1 rounded-control border border-review/50 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-review">📍 მდებარეობა გამორთულია — აღწერა მაინც შეიძლება</span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onRetry();
            setBusy(false);
            setHelp(true);
          }}
          className="shrink-0 rounded-control border border-rule-strong px-2 py-1"
        >
          {busy ? '…' : 'ჩართვა'}
        </button>
      </div>
      {help && (
        <p className="text-ink-soft">
          iPhone: პარამეტრები → კონფიდენციალურობა → მდებარეობის სერვისები (ჩართე) → Safari-ს საიტები
          → „გამოყენებისას“. მერე Safari-ში aA → ვებგვერდის პარამეტრები → მდებარეობა → დაშვება.
        </p>
      )}
    </div>
  );
}
