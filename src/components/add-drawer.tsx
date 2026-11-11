'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * The page's "+": a round green button at the top left of its table that opens
 * the adding form in a drawer from the right, over the table. Esc, ✕ or a click
 * on the shade closes it. `startOpen` opens it on arrival (?add=1 links).
 */
export default function AddDrawer({
  title,
  label,
  startOpen = false,
  children,
}: {
  title: string;
  /** Shown next to the "+" on wide screens. */
  label?: string;
  startOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#1f7a4d] px-3 text-white shadow-sm transition hover:bg-[#155c39]"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label && <span className="hidden pr-1 text-sm font-semibold sm:inline">{label}</span>}
      </button>
      <div
        className={`fixed inset-0 z-50 transition ${open ? 'visible' : 'invisible'}`}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-[#0b1f15]/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`absolute inset-y-0 right-0 flex w-[min(30rem,100vw)] flex-col bg-paper-sunk shadow-2xl transition-transform duration-300 ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="დახურვა"
              className="grid h-9 w-9 place-items-center rounded-full border border-rule-strong text-lg hover:bg-ink/5"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-5">{open && children}</div>
        </aside>
      </div>
    </>
  );
}
