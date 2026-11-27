'use client';

import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui';
import { dropBookShelves, repairNumericUnits } from '../../actions';

/**
 * Fixes for a loaded balance, at the bottom of the balance page: drop the
 * balance's shelves when none matches a counted shelf (asks first; the
 * balance with shelves stays as a version), mend units a price column
 * overwrote. Nothing is deleted: a wrong balance is cancelled in the list of
 * versions.
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
  const [ask, setAsk] = useState<'drop' | null>(null);
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();
  if ((!hasBook || !shelfMismatch) && !badUnits && !msg) return null;

  const confirm = (text: string, yes: string, run: () => Promise<typeof msg>) => (
    <div className="grid gap-2 rounded-xl border border-[#d64545]/30 bg-paper p-3">
      <p>{text}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(await run());
              setAsk(null);
            })
          }
          className="rounded-xl bg-[#d64545] px-4 py-2 font-semibold text-white"
        >
          {pending ? '…' : yes}
        </button>
        <button
          type="button"
          onClick={() => setAsk(null)}
          className="rounded-xl border border-rule-strong px-4 py-2"
        >
          არა
        </button>
      </div>
    </div>
  );

  return (
    <section className="grid gap-3 rounded-2xl border border-rule/70 bg-paper-sunk/60 p-5 text-sm">
      <h2 className="text-base font-semibold">ნაშთის გასწორება</h2>

      {shelfMismatch && (
        <div className="grid gap-2 rounded-xl border border-[#d64545]/30 bg-[#d64545]/5 p-4">
          <p className="font-semibold text-mismatch">⚠ {shelfMismatch}</p>
          {ask === 'drop' ? (
            confirm(
              'ნაშთის ხაზებს თაროს კოდი მოეხსნება (რაოდენობა და ფასი რჩება) და შედარება პროდუქტებით, მთელ საწყობზე მოხდება. თაროებიანი ნაშთი ვერსიებში დარჩება.',
              'კი, მოხსენი',
              () => dropBookShelves(stocktakeId),
            )
          ) : (
            <button
              type="button"
              onClick={() => setAsk('drop')}
              className="w-fit rounded-xl border border-rule-strong bg-paper px-4 py-2 font-medium"
            >
              📍 თაროები ნაშთიდან მოხსნა
            </button>
          )}
        </div>
      )}

      {badUnits > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setMsg(await repairNumericUnits()))}
          className="w-fit rounded-xl border border-rule-strong bg-paper px-4 py-2 font-medium"
          title="ფასის სვეტი შეცდომით ერთეულად წაიკითხა — ერთეული „ცალი“ დაუბრუნდება"
        >
          🔧 {badUnits} პროდუქტს ერთეულად რიცხვი აქვს — გასწორება
        </button>
      )}

      {msg?.error && <Alert>{msg.error}</Alert>}
      {msg?.notice && <Alert tone="info">{msg.notice}</Alert>}
    </section>
  );
}
