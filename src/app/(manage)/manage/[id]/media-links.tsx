'use client';

import { useState, useTransition } from 'react';
import Lightbox, { type LightboxItem } from '@/components/lightbox';
import { shelfMedia } from '@/app/(count)/count/actions';

const label = (photos: number, videos: number) =>
  [photos ? `${photos} ფოტო` : '', videos ? `${videos} ვიდეო` : ''].filter(Boolean).join(' · ');

/** Each shelf as "K-01 · 3 ფოტო · 1 ვიდეო"; a click opens them in the viewer. */
export function ShelfMediaLinks({
  stocktakeId,
  shelves,
}: {
  stocktakeId: string;
  shelves: { id: string; code: string; photos: number; videos: number }[];
}) {
  const [open, setOpen] = useState<{ title: string; items: LightboxItem[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <>
      {shelves.map((sh) => (
        <button
          key={sh.id}
          type="button"
          onClick={() => {
            setBusy(sh.id);
            start(async () => {
              const items = await shelfMedia(stocktakeId, sh.id).catch(() => []);
              setBusy(null);
              if (items.length) setOpen({ title: sh.code, items });
            });
          }}
          className="whitespace-nowrap text-[#2b6cb0] underline print:text-black print:no-underline"
        >
          {busy === sh.id ? '…' : `📷 ${sh.code} · ${label(sh.photos, sh.videos)}`}
        </button>
      ))}
      {open && <Lightbox items={open.items} title={open.title} onClose={() => setOpen(null)} />}
    </>
  );
}

/** 🖼 the photo of one line, in the same viewer. */
export function LinePhoto({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="პოზიციის ფოტო"
        className="text-[#2b6cb0]"
      >
        🖼
      </button>
      {open && (
        <Lightbox items={[{ url, kind: 'photo' }]} title={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
