'use client';

import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui';
import { clearBook, dropBookShelves, repairNumericUnits } from '../../actions';

/**
 * Ways out of a wrong upload: empty the balance and load the right file, and
 * mend product units that a price column overwrote.
 */
export default function BookFixes({
  stocktakeId,
  hasBook,
  badUnits,
  shelfMismatch,
}: {
  stocktakeId: string;
  hasBook: boolean;
  badUnits: number;
  /** The balance's shelves and the counted shelves have nothing in common. */
  shelfMismatch: string | null;
}) {
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!hasBook && !badUnits && !msg) return null;
  const problem = !!shelfMismatch || badUnits > 0;
  return (
    <div
      className={`grid gap-2 text-sm ${problem ? 'rounded-xl border border-[#d64545]/30 bg-[#d64545]/5 p-4' : ''}`}
    >
      {shelfMismatch && <p className="font-semibold text-mismatch">⚠ {shelfMismatch}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {hasBook &&
          (ask ? (
            <>
              <span>ნამდვილად წავშალო ჩატვირთული ნაშთი?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg(await clearBook(stocktakeId));
                    setAsk(false);
                  })
                }
                className="rounded-full bg-[#d64545] px-3 py-1 font-semibold text-white"
              >
                {pending ? '…' : 'კი, წაშალე'}
              </button>
              <button type="button" onClick={() => setAsk(false)} className="underline">
                არა
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAsk(true)}
              className="text-xs text-ink-faint underline decoration-dotted hover:text-[#d64545]"
            >
              🗑 ჩატვირთული ნაშთის წაშლა
            </button>
          ))}
        {shelfMismatch && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setMsg(await dropBookShelves(stocktakeId)))}
            className="rounded-full bg-[#1f7a4d] px-3 py-1 font-semibold text-white"
          >
            📍 თაროები ნაშთიდან მოხსნა — შედარება პროდუქტებით
          </button>
        )}
        {badUnits > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setMsg(await repairNumericUnits()))}
            className="rounded-full border border-rule-strong px-3 py-1 font-medium"
            title="ფასის სვეტი შეცდომით ერთეულად წაიკითხა — ერთეული „ცალი“ დაუბრუნდება"
          >
            🔧 {badUnits} პროდუქტს ერთეულად რიცხვი აქვს — გასწორება
          </button>
        )}
      </div>
      {msg?.error && <Alert>{msg.error}</Alert>}
      {msg?.notice && <Alert tone="info">{msg.notice}</Alert>}
    </div>
  );
}
