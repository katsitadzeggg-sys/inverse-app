'use client';

import { useState, useTransition } from 'react';
import { productPhoto } from '../../actions';

/** "🖼 ფოტოს ჩვენება": the product's own photo, to compare with what is on the shelf. */
export default function ProductPhoto({ productId }: { productId: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function show() {
    if (open) return setOpen(false);
    setOpen(true);
    if (url !== undefined) return;
    start(async () => setUrl(await productPhoto(productId).catch(() => null)));
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={show}
        className="w-fit rounded-control border border-rule-strong px-3 py-1.5 text-sm font-medium"
      >
        🖼 {open ? 'ფოტოს დამალვა' : 'ფოტოს ჩვენება'}
      </button>
      {open &&
        (pending || url === undefined ? (
          <p className="text-sm text-ink-soft">…</p>
        ) : url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="max-h-72 w-full rounded-control object-contain" />
          </a>
        ) : (
          <p className="text-sm text-ink-soft">ამ პროდუქტს ფოტო არ აქვს.</p>
        ))}
    </div>
  );
}
