'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { searchAll, type Hit } from './search-actions';

/** One search on the dashboard: results drop down while typing. */
export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      const r = await searchAll(t);
      // A slower, older answer never overwrites a newer one.
      if (n === seq.current) {
        setHits(r);
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const click = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  const short = q.trim().length < 2;
  return (
    <div ref={box} className="relative min-w-[14rem] flex-1 sm:max-w-md">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="ძებნა: ინვენტარიზაცია, საწყობი, თანამშრომელი"
        className="w-full rounded-full border border-rule bg-paper py-2.5 pl-10 pr-10 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      {busy && !short && (
        <span className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-rule border-t-accent" />
      )}
      {open && !short && !busy && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-40 max-h-96 overflow-y-auto rounded-2xl border border-rule bg-paper-sunk p-1.5 shadow-xl">
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-faint">ვერაფერი მოიძებნა.</p>
          ) : (
            hits.map((h) => (
              <Link
                key={`${h.kind}-${h.href}-${h.title}`}
                href={h.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2 hover:bg-ink/5"
              >
                <span className="block text-sm font-medium">{h.title}</span>
                <span className="block truncate text-xs text-ink-faint">{h.sub}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
