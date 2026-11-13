'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, inputClass } from '@/components/ui';
import { askAssistant, type ChatTurn } from './actions';

const EXAMPLES = [
  'რომელი ინვენტარიზაციებია ახლა ღია?',
  'ბოლო ინვენტარიზაციაში რომელ პროდუქტზეა ყველაზე დიდი ნაკლებობა?',
  'რამდენი თაროა დარჩენილი დასათვლელი?',
];

export default function Chat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, pending]);

  function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', text: question }];
    setTurns(next);
    setText('');
    setError(null);
    start(async () => {
      const r = await askAssistant(next).catch(
        () => ({ error: 'კავშირი გაწყდა. სცადე თავიდან.' }) as { text?: string; error?: string },
      );
      if (r.error || !r.text) {
        setError(r.error ?? 'პასუხი ვერ მივიღე.');
        setTurns(turns); // the question goes back into the box to retry
        setText(question);
        return;
      }
      setTurns([...next, { role: 'assistant', text: r.text }]);
    });
  }

  return (
    <div className="grid gap-3">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => ask(e)}
              className="rounded-full border border-rule-strong px-3 py-1.5 text-left text-sm"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-2xl bg-accent/15 px-3 py-2 text-sm'
                : 'mr-auto max-w-[95%] whitespace-pre-wrap rounded-2xl border border-rule px-3 py-2 text-sm'
            }
          >
            {t.text}
          </div>
        ))}
        {pending && (
          <div className="mr-auto px-3 py-2 text-sm text-ink-faint">ვეძებ მონაცემებში…</div>
        )}
        <div ref={end} />
      </div>
      {error && <Alert>{error}</Alert>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="მაგ. INV-2026-0111-ში რა აკლია?"
          className={`${inputClass} text-base`}
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="rounded-control bg-ink px-4 text-sm font-semibold text-paper disabled:opacity-50"
        >
          გაგზავნა
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              setError(null);
            }}
            disabled={pending}
            className="rounded-control border border-rule-strong px-3 text-sm"
          >
            ახალი
          </button>
        )}
      </form>
    </div>
  );
}
