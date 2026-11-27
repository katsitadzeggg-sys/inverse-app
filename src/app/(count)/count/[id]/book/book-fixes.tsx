'use client';

import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui';
import { clearBook, dropBookShelves, repairNumericUnits } from '../../actions';

/**
 * Ways out of a wrong upload, at the bottom of the balance page: drop the
 * balance's shelves when none matches a counted shelf, mend units a price
 * column overwrote, and empty the balance. Each one that cannot be undone
 * asks first.
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
  const [ask, setAsk] = useState<'clear' | 'drop' | null>(null);
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!hasBook && !badUnits && !msg) return null;

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
              'ნაშთის ხაზებს თაროს კოდი მოეხსნება (რაოდენობა და ფასი რჩება) და შედარება პროდუქტებით, მთელ საწყობზე მოხდება. თაროების დასაბრუნებლად ფაილი თავიდან უნდა ატვირთო.',
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

      {hasBook &&
        (ask === 'clear' ? (
          confirm('ნამდვილად წავშალო ჩატვირთული ნაშთი? დათვლილი არ წაიშლება.', 'კი, წაშალე', () =>
            clearBook(stocktakeId),
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setAsk('clear')}
              className="rounded-xl border border-[#d64545]/40 bg-paper px-4 py-2 font-medium text-[#d64545]"
            >
              🗑 ნაშთის წაშლა
            </button>
            <span className="text-xs text-ink-faint">
              მხოლოდ მაშინ, თუ ნაშთი შეცდომით ამ ინვენტარიზაციაში ჩაიტვირთა. სწორი ფაილისთვის წაშლა
              არ გჭირდება — ახალი ატვირთვა ძველს ჩაანაცვლებს.
            </span>
          </div>
        ))}

      {msg?.error && <Alert>{msg.error}</Alert>}
      {msg?.notice && <Alert tone="info">{msg.notice}</Alert>}
    </section>
  );
}
