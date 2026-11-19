'use client';

import { useEffect, useRef, useState } from 'react';
import { aiCheckShelf, type AiWarning } from '../../../ai-actions';
import { videoFrames } from './ai-check';

/**
 * The counter's automatic photo check (company switch on): a few seconds
 * after the last photo / video of the closed shelf, the photos are checked in
 * the background — only right after shooting (the newest shot under 10
 * minutes old). Opening an old shelf again does not run (and pay for) it
 * again; "შეამოწმე" does that by hand. The counter hears only about counted products the photos
 * show in another quantity — never the balance.
 */
export default function AutoCheck({
  stocktakeId,
  locationId,
  photos,
  videos,
  lastShotAt,
}: {
  stocktakeId: string;
  locationId: string;
  photos: number;
  videos: string[];
  /** When the newest photo / video of the shelf was saved. */
  lastShotAt: string;
}) {
  const [state, setState] = useState<
    | { s: 'idle' }
    | { s: 'busy' }
    | { s: 'done'; warnings: AiWarning[] }
    | { s: 'error'; msg: string }
  >({ s: 'idle' });
  const media = photos + videos.length;
  const ran = useRef<string | null>(null);

  useEffect(() => {
    if (!media || !lastShotAt) return;
    if (Date.now() - new Date(lastShotAt).getTime() > 10 * 60 * 1000) return;
    const key = `ai-auto:${stocktakeId}:${locationId}:${media}`;
    // Once per set of shots (a new photo starts a new check).
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {}
    const t = setTimeout(async () => {
      if (ran.current === key) return;
      ran.current = key;
      try {
        sessionStorage.setItem(key, '1');
      } catch {}
      setState({ s: 'busy' });
      const frames: string[] = [];
      for (const url of videos.slice(0, 2)) {
        try {
          frames.push(...(await videoFrames(url, 4)));
        } catch {}
      }
      const r = await aiCheckShelf(stocktakeId, locationId, frames.slice(0, 8), true).catch(
        (e) => ({ error: String(e).slice(0, 150), warnings: undefined }),
      );
      setState(r.error ? { s: 'error', msg: r.error } : { s: 'done', warnings: r.warnings ?? [] });
    }, 6000);
    return () => clearTimeout(t);
  }, [media, stocktakeId, locationId, videos, lastShotAt]);

  if (!media || state.s === 'idle') return null;
  if (state.s === 'busy')
    return (
      <p className="rounded-control bg-paper-sunk p-3 text-center text-sm text-ink-soft">
        🤖 ფოტოებს ვამოწმებ… შეგიძლია გააგრძელო.
      </p>
    );
  if (state.s === 'error')
    return (
      <p className="text-center text-xs text-ink-faint">
        🤖 შემოწმება ვერ მოხერხდა{state.msg ? `: ${state.msg}` : '.'} სცადე „შეამოწმე“.
      </p>
    );
  if (!state.warnings.length)
    return (
      <p className="rounded-control border border-match/50 p-3 text-center text-sm text-match">
        🤖 ფოტოები დათვლილს ემთხვევა.
      </p>
    );
  return (
    <section className="grid gap-1.5 rounded-control border-2 border-review p-3">
      <p className="font-semibold text-review">🤖 ფოტოზე სხვა რაოდენობა ჩანს — გადაამოწმე:</p>
      <ul className="grid gap-1 text-sm">
        {state.warnings.map((w, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{w.name}</span>
            <span className="shrink-0 tabular-nums">
              დათვალე {w.counted} · ფოტოზე ~{w.detected}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-faint">
        თუ რაოდენობა სწორია, ყურადღება არ მიაქციო — ფოტოზე ყველა ცალი შეიძლება არ ჩანდეს.
      </p>
    </section>
  );
}
