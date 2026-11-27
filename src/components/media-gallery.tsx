'use client';

import { useEffect, useState } from 'react';

export type GalleryItem = {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  poster?: string | null;
  caption?: string | null;
};

/**
 * Photos and videos as a row of thumbnails; a tap opens one large over the
 * page, with ← → to move and Esc (or a tap outside) to close.
 */
export default function MediaGallery({ items }: { items: GalleryItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open == null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i == null ? i : (i + 1) % items.length));
      if (e.key === 'ArrowLeft')
        setOpen((i) => (i == null ? i : (i - 1 + items.length) % items.length));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, items.length]);
  if (!items.length) return null;
  const cur = open == null ? null : items[open];

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
        {items.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-paper-sunk"
              title={m.caption ?? undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
              <img
                src={m.kind === 'video' ? (m.poster ?? '') : m.url}
                alt=""
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              {m.kind === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">
                  ▶
                </span>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">
                {i + 1}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
        >
          <div className="relative max-h-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            {cur.kind === 'video' ? (
              <video
                src={cur.url}
                poster={cur.poster ?? undefined}
                controls
                autoPlay
                playsInline
                className="max-h-[85vh] max-w-full rounded-xl bg-black"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
              <img src={cur.url} alt="" className="max-h-[85vh] max-w-full rounded-xl" />
            )}
            {cur.caption && <p className="mt-2 text-center text-sm text-white">{cur.caption}</p>}
          </div>
          {items.length > 1 && (
            <>
              <button
                type="button"
                aria-label="წინა"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((open! - 1 + items.length) % items.length);
                }}
                className="absolute left-4 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="შემდეგი"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((open! + 1) % items.length);
                }}
                className="absolute right-4 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
              >
                ›
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="დახურვა"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 h-10 w-10 rounded-full bg-white/15 text-xl text-white hover:bg-white/25"
          >
            ✕
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">
            {open! + 1} / {items.length}
          </span>
        </div>
      )}
    </>
  );
}
