'use client';

import { useState, type CSSProperties } from 'react';
import type { AiResult } from '../../../ai-actions';

const color = {
  match: '#22c55e',
  partial: '#eab308',
  mismatch: '#ef4444',
  unknown: '#eab308',
} as const;

/**
 * The shelf photos with the AI's frames drawn over them: green where the
 * photo shows what was counted, yellow where it can't tell, red where it
 * sees another quantity. Each frame carries the product, its code and how
 * sure the model is. Boxes come from the model and are approximate.
 */
export default function ShelfHud({
  result,
  urls,
  focus = null,
  wide = false,
}: {
  result: AiResult;
  /** The product picked in the list below: its frames stand out, the rest fade. */
  focus?: number | null;
  /** Manager's wide page: photos side by side; a tap makes one full width. */
  wide?: boolean;
  /** Signed URL per storage path (photos, and video posters). */
  urls: Record<string, string>;
}) {
  const [labels, setLabels] = useState(true);
  const [big, setBig] = useState<number | null>(null);
  const paths = result.paths ?? [];
  const shots = paths
    .map((path, image) => ({
      image,
      url: path ? urls[path] : undefined,
      boxes: result.items.flatMap((item, idx) =>
        (item.boxes ?? []).filter((b) => b.image === image).map((b) => ({ ...b, item, idx })),
      ),
    }))
    .filter((s) => s.url && s.boxes.length);
  if (!shots.length) return null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-hud text-xs text-ink-soft">AI DETECTION · {shots.length} IMG</p>
        <button
          type="button"
          onClick={() => setLabels((v) => !v)}
          className="rounded-control border border-rule px-2 py-1 text-xs"
        >
          {labels ? 'სახელების დამალვა' : 'სახელების ჩვენება'}
        </button>
      </div>
      <div className={wide ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-2'}>
        {shots.map((s) => (
          <figure
            key={s.image}
            id={`ai-img-${s.image}`}
            onClick={wide ? () => setBig((b) => (b === s.image ? null : s.image)) : undefined}
            className={`relative scroll-mt-20 overflow-hidden rounded-control bg-black ${wide ? 'cursor-zoom-in' : ''} ${wide && (big === s.image || (focus != null && s.boxes.some((b) => b.idx === focus))) ? 'col-span-full cursor-zoom-out' : ''}`}
            style={{ boxShadow: '0 0 0 1px #0ea5e955, 0 0 18px #0ea5e933 inset' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={s.url} alt="" className="block w-full" />
            {/* Scan grid */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(#38bdf812 1px, transparent 1px), linear-gradient(90deg, #38bdf812 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
            {s.boxes.map((b, n) => {
              const c = color[b.item.status];
              const on = focus === b.idx;
              const dim = focus != null && !on;
              const corner = (pos: CSSProperties) => (
                <span
                  className="absolute h-2.5 w-2.5"
                  style={{ ...pos, borderColor: c, borderStyle: 'solid' }}
                />
              );
              return (
                <div
                  key={n}
                  className="absolute"
                  style={{
                    left: `${b.x0 * 100}%`,
                    top: `${b.y0 * 100}%`,
                    width: `${(b.x1 - b.x0) * 100}%`,
                    height: `${(b.y1 - b.y0) * 100}%`,
                    border: on ? `3px solid ${c}` : `1px solid ${c}99`,
                    background: on ? `${c}26` : `${c}14`,
                    boxShadow: on ? `0 0 0 9999px #0008, 0 0 16px ${c}` : `0 0 8px ${c}66`,
                    opacity: dim ? 0.35 : 1,
                    zIndex: on ? 2 : 1,
                  }}
                >
                  {corner({ left: -2, top: -2, borderWidth: '2px 0 0 2px' })}
                  {corner({ right: -2, top: -2, borderWidth: '2px 2px 0 0' })}
                  {corner({ left: -2, bottom: -2, borderWidth: '0 0 2px 2px' })}
                  {corner({ right: -2, bottom: -2, borderWidth: '0 2px 2px 0' })}
                  {(labels || on) && (
                    <span
                      className={`absolute left-0 max-w-[14rem] px-1 py-0.5 text-[10px] leading-tight text-white ${b.y0 < 0.08 ? 'top-0' : '-translate-y-full'}`}
                      style={{
                        ...(b.y0 < 0.08 ? {} : { top: -2 }),
                        background: '#020617d9',
                        borderLeft: `2px solid ${c}`,
                      }}
                    >
                      <span className="block truncate">{b.item.name}</span>
                      <span className="font-hud block" style={{ color: c }}>
                        {b.item.code && `${b.item.code} · `}
                        {Math.round(b.item.confidence * 100)}%
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
            <figcaption className="font-hud absolute bottom-1 right-2 text-[10px] text-sky-300">
              IMG {s.image + 1} · {s.boxes.length} OBJ
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        ჩარჩოები მიახლოებითია: AI აჩვენებს, სად დაინახა პროდუქტი. რაოდენობა და % ქვემოთ ცხრილშია.
      </p>
    </div>
  );
}
