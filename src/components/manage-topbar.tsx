'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { markAllRead, setTheme } from '@/app/(manage)/manage/me-actions';

export type Note = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
};

/** Closes a dropdown on a click outside it or Esc. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const ago = (t: string) =>
  new Date(t).toLocaleString('ka-GE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tbilisi',
  });
const panel =
  'absolute right-0 top-[calc(100%+0.5rem)] z-40 rounded-2xl border border-rule bg-paper-sunk shadow-xl';

/** 🔔 with the unread count; the latest notices drop down under it. */
export function Bell({ notes }: { notes: Note[] }) {
  const { open, setOpen, ref } = useDropdown();
  const [, start] = useTransition();
  const unread = notes.filter((n) => !n.read).length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) start(() => markAllRead());
        }}
        aria-label="შეტყობინებები"
        className="relative grid h-10 w-10 place-items-center rounded-full border border-rule bg-paper hover:bg-ink/5"
      >
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#d64545] px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className={`${panel} w-[min(22rem,calc(100vw-2rem))]`}>
          <p className="border-b border-rule px-4 py-3 text-sm font-semibold">შეტყობინებები</p>
          <ul className="max-h-96 overflow-y-auto">
            {notes.length === 0 && (
              <li className="px-4 py-4 text-sm text-ink-faint">ჯერ არაფერია.</li>
            )}
            {notes.slice(0, 6).map((n) => (
              <li key={n.id} className="border-b border-rule/70 px-4 py-3 last:border-0">
                <p className="flex items-start gap-2 text-sm font-medium">
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1f7a4d]" />
                  )}
                  {n.title}
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{n.body}</p>}
                <p className="mt-1 text-[11px] text-ink-faint">{ago(n.created_at)}</p>
              </li>
            ))}
          </ul>
          <Link
            href="/manage/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-b-2xl border-t border-rule px-4 py-3 text-center text-sm font-semibold text-accent hover:bg-ink/5"
          >
            ყველა შეტყობინება →
          </Link>
        </div>
      )}
    </div>
  );
}

/** The person: avatar and name; the menu holds profile, theme and sign-out. */
export function ProfileMenu({
  name,
  sub,
  initials,
  theme,
}: {
  name: string;
  sub: string;
  initials: string;
  theme: 'light' | 'dark';
}) {
  const { open, setOpen, ref } = useDropdown();
  const [pending, start] = useTransition();
  const item =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-ink/5';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 rounded-full py-1 pl-1 pr-3 hover:bg-ink/5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#dcefe4] text-sm font-semibold text-[#155c39]">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block text-xs text-ink-faint">{sub}</span>
        </span>
        <span className="text-ink-faint" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div role="menu" className={`${panel} w-64 p-2`}>
          <Link href="/manage/profile" onClick={() => setOpen(false)} className={item}>
            👤 ჩემი პროფილი
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              // Switch at once; the cookie keeps it for the next visit.
              document
                .querySelector('[data-manage-root]')
                ?.classList.toggle('theme-dark', theme === 'light');
              start(() => setTheme(theme === 'light' ? 'dark' : 'light'));
            }}
            className={item}
          >
            {theme === 'light' ? '🌙 მუქი თემა' : '☀️ ღია თემა'}
          </button>
          <form action="/auth/signout" method="post" className="mt-1 border-t border-rule pt-1">
            <button type="submit" className={`${item} text-mismatch`}>
              ↪ გასვლა
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
