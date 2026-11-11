'use client';

import { useEffect, useState } from 'react';

export type LightboxItem = {
  url: string;
  kind: 'photo' | 'video';
  poster?: string | null;
  caption?: string | null;
};

/**
 * Photos and videos full screen, one at a time: ← → (or the side buttons)
 * move between them, Esc (or ✕, or a click outside) closes.
 */
export default function Lightbox({
  items,
  start = 0,
  title,
  onClose,
}: {
  items: LightboxItem[];
  start?: number;
  title?: string;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const n = items.length;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((v) => (v + 1) % n);
      else if (e.key === 'ArrowLeft') setI((v) => (v - 1 + n) % n);
    };
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
    };
  }, [n, onClose]);
  if (!n) return null;
  const m = items[i];
  const nav =
    'absolute top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-3xl text-white hover:bg-white/30';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 grid grid-rows-[auto_1fr_auto] bg-black/90 p-3 text-white"
    >
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-sm">
          {title && <b>{title} · </b>}
          {i + 1} / {n}
          {m.caption && <span className="text-white/70"> · {m.caption}</span>}
        </p>
        <a href={m.url} target="_blank" rel="noreferrer" className="text-sm underline">
          ⬇ ორიგინალი
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="დახურვა (Esc)"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl hover:bg-white/30"
        >
          ✕
        </button>
      </div>
      <div className="relative grid min-h-0 place-items-center">
        {m.kind === 'video' ? (
          <video
            key={m.url}
            src={m.url}
            poster={m.poster ?? undefined}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={m.url}
            src={m.url}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {n > 1 && (
          <>
            <button
              type="button"
              aria-label="წინა (←)"
              onClick={(e) => {
                e.stopPropagation();
                setI((v) => (v - 1 + n) % n);
              }}
              className={`${nav} left-2`}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="შემდეგი (→)"
              onClick={(e) => {
                e.stopPropagation();
                setI((v) => (v + 1) % n);
              }}
              className={`${nav} right-2`}
            >
              ›
            </button>
          </>
        )}
      </div>
      <p className="pt-2 text-center text-xs text-white/60">← → გადასვლა · Esc გამოსვლა</p>
    </div>
  );
}
