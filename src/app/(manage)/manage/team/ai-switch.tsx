'use client';

import { useTransition } from 'react';
import { setAiShelfCheck } from '../me-actions';

/** Manager's switch for the counters' automatic photo check. */
export default function AiSwitch({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-3 rounded-xl border border-rule bg-paper p-4 text-sm">
      <input
        type="checkbox"
        defaultChecked={on}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          start(() => setAiShelfCheck(v));
        }}
        className="mt-0.5 h-5 w-5"
      />
      <span>
        <b>🤖 AI შემოწმება თაროს დახურვისას</b>
        <span className="block text-ink-soft">
          აღმწერი თაროს ფოტოს რომ გადაიღებს, AI ავტომატურად ადარებს დათვლილს და, თუ ფოტოზე სხვა
          რაოდენობა ჩანს, ეუბნება „გადაამოწმე“. ნაშთს არ აჩვენებს. ყოველი თარო AI-ს ხარჯია.
        </span>
      </span>
    </label>
  );
}
