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
  return (
    <div className="grid gap-2 rounded-control border border-[#d64545]/30 bg-[#d64545]/5 p-4 text-sm">
      <p className="font-semibold">🔧 არასწორი ფაილი ჩაიტვირთა?</p>
      {shelfMismatch && <p className="font-semibold text-mismatch">⚠ {shelfMismatch}</p>}
      <ul className="grid list-disc gap-1 pl-5 text-ink-soft">
        <li>
          უბრალოდ ატვირთე სწორი ფაილი — ძველ ნაშთს ჩაანაცვლებს (ამავე საწყობის ღია
          ინვენტარიზაციებშიც). დათვლილი რაოდენობები ხელუხლებელი რჩება.
        </li>
        <li>ან ჯერ წაშალე ჩატვირთული ნაშთი და მერე ატვირთე.</li>
      </ul>
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
              className="rounded-full border border-[#d64545]/50 px-3 py-1 font-medium text-[#d64545]"
            >
              🗑 ნაშთის წაშლა
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
