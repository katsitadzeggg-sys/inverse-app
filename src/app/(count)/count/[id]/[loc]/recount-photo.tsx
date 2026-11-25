'use client';

import { useEffect, useState } from 'react';
import { recountPhoto, type RecountPhoto } from '../../actions';

/**
 * The picture beside a product to recount, shown at once: the shelf photo
 * with the product framed in green, or the product's own picture. A tap
 * opens it full size.
 */
export default function RecountPhotoView({
  stocktakeId,
  locationId,
  productId,
}: {
  stocktakeId: string;
  locationId: string;
  productId: string;
}) {
  const [photo, setPhoto] = useState<RecountPhoto | null | undefined>(undefined);
  // The photo's own size, read when it loads: the zoomed view needs its shape.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let live = true;
    recountPhoto(stocktakeId, locationId, productId)
      .then((p) => live && setPhoto(p))
      .catch(() => live && setPhoto(null));
    return () => {
      live = false;
    };
  }, [stocktakeId, locationId, productId]);

  if (photo === undefined)
    return <div className="h-44 animate-pulse rounded-control bg-paper-sunk" aria-hidden />;
  if (photo === null) return null;

  const { box } = photo;
  // With a frame, show the part of the shelf around it, zoomed in, so the
  // product is easy to find; a tap opens the whole photo.
  const region =
    box && size
      ? (() => {
          const padX = Math.max(0.12, (box.x1 - box.x0) * 0.8);
          const padY = Math.max(0.1, (box.y1 - box.y0) * 0.8);
          const x0 = Math.max(0, box.x0 - padX);
          const y0 = Math.max(0, box.y0 - padY);
          const x1 = Math.min(1, box.x1 + padX);
          const y1 = Math.min(1, box.y1 + padY);
          return { x0, y0, w: x1 - x0, h: y1 - y0 };
        })()
      : null;
  return (
    <figure className="grid gap-1">
      <a href={photo.url} target="_blank" rel="noreferrer" className="block">
        {region && size ? (
          <div
            className="relative w-full overflow-hidden rounded-control bg-black/20"
            style={{
              aspectRatio: String(
                Math.min(2, Math.max(0.75, (region.w * size.w) / (region.h * size.h))),
              ),
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt=""
              className="absolute max-w-none"
              style={{
                width: `${100 / region.w}%`,
                height: `${100 / region.h}%`,
                left: `${(-region.x0 / region.w) * 100}%`,
                top: `${(-region.y0 / region.h) * 100}%`,
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-[3px] border-match"
              style={{
                left: `${((box!.x0 - region.x0) / region.w) * 100}%`,
                top: `${((box!.y0 - region.y0) / region.h) * 100}%`,
                width: `${((box!.x1 - box!.x0) / region.w) * 100}%`,
                height: `${((box!.y1 - box!.y0) / region.h) * 100}%`,
              }}
            />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt=""
            onLoad={(e) =>
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            className="block max-h-64 w-full rounded-control bg-black/20 object-contain"
          />
        )}
      </a>
      <figcaption className="text-xs text-ink-faint">
        {photo.source === 'product'
          ? 'პროდუქტის ფოტო'
          : 'აქ ნახა AI-მ — თაროს ფოტო (შეეხე სრულად სანახავად)'}
      </figcaption>
    </figure>
  );
}
