'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert } from '@/components/ui';
import { askAssistant, type ChatTurn } from './actions';

type Thread = { id: string; title: string; turns: ChatTurn[]; at: number };

// Chats are kept in this browser only (one manager, one computer); a lost or
// unreadable store just starts with an empty list.
const KEY = 'inverse-assistant-chats';
const load = (): Thread[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const save = (t: Thread[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(t.slice(0, 50)));
  } catch {
    // storage full or blocked — the chat still works for this visit
  }
};
const newId = () => Math.random().toString(36).slice(2, 10);

export default function Chat() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setThreads(load()), 0);
    return () => clearTimeout(t);
  }, []);

  const thread = threads.find((t) => t.id === current);
  const turns = thread?.turns ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, pending]);

  useEffect(() => {
    box.current?.focus();
  }, [current]);

  function update(id: string, title: string, next: ChatTurn[]) {
    setThreads((prev) => {
      const rest = prev.filter((t) => t.id !== id);
      const list = [{ id, title, turns: next, at: Date.now() }, ...rest];
      save(list);
      return list;
    });
  }

  function ask() {
    const question = text.trim();
    if (!question || pending) return;
    const id = current ?? newId();
    const title = thread?.title ?? question.slice(0, 60);
    const next: ChatTurn[] = [...turns, { role: 'user', text: question }];
    setCurrent(id);
    update(id, title, next);
    setText('');
    setError(null);
    start(async () => {
      const r = await askAssistant(next).catch(
        () => ({ error: 'კავშირი გაწყდა. სცადე თავიდან.' }) as { text?: string; error?: string },
      );
      if (r.error || !r.text) {
        setError(r.error ?? 'პასუხი ვერ მივიღე.');
        update(id, title, turns);
        setText(question);
        return;
      }
      update(id, title, [...next, { role: 'assistant', text: r.text }]);
    });
  }

  function remove(id: string) {
    setThreads((prev) => {
      const list = prev.filter((t) => t.id !== id);
      save(list);
      return list;
    });
    if (current === id) setCurrent(null);
  }

  return (
    <div className="grid min-h-[calc(100dvh-12rem)] gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="grid content-start gap-1 rounded-2xl border border-rule/70 bg-paper-sunk p-3">
        <button
          type="button"
          onClick={() => {
            setCurrent(null);
            setError(null);
            setText('');
          }}
          className="mb-2 rounded-full border border-[#1f7a4d] px-4 py-2 text-sm font-semibold text-[#155c39] hover:bg-[#eef7f1]"
        >
          + ახალი ჩატი
        </button>
        {threads.map((t) => (
          <div
            key={t.id}
            className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm ${
              t.id === current ? 'bg-paper font-medium' : 'hover:bg-paper'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setCurrent(t.id);
                setError(null);
              }}
              className="min-w-0 flex-1 truncate text-left"
              title={t.title}
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="shrink-0 rounded px-1 text-ink-faint opacity-0 hover:text-mismatch group-hover:opacity-100"
              aria-label="ჩატის წაშლა"
            >
              ✕
            </button>
          </div>
        ))}
      </aside>

      <section className="flex min-h-0 flex-col rounded-2xl border border-rule/70 bg-paper-sunk">
        <div className="grid flex-1 content-start gap-2 overflow-y-auto p-5">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-2xl bg-accent/15 px-3 py-2 text-sm'
                  : 'mr-auto max-w-[95%] whitespace-pre-wrap rounded-2xl border border-rule bg-paper px-3 py-2 text-sm'
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
        {error && (
          <div className="px-5">
            <Alert>{error}</Alert>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="flex items-end gap-2 border-t border-rule/70 p-3"
        >
          <textarea
            ref={box}
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            aria-label="კითხვა"
            className="min-h-12 flex-1 resize-none rounded-xl border border-rule bg-paper px-3 py-2 text-base outline-none focus:border-[#1f7a4d]"
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="rounded-full bg-[#1f7a4d] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            გაგზავნა
          </button>
        </form>
      </section>
    </div>
  );
}
