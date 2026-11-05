'use client';

import { useEffect, useRef, useState } from 'react';
import { drawLabel, labelsToZpl } from '@/lib/zebra';

const SIZE = { w: 38, h: 38 };

/**
 * Before the photos: the new sticker for an asset without a label. Shows it as
 * it will print and hands over a one-label ZPL file for the Zebra printer, so
 * the photo of the label already shows the new sticker.
 */
export default function LabelStep({ code, title, company, onDone }: { code: string; title: string; company: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    const c = drawLabel(SIZE, { code, title, footer: company });
    c.style.width = '140px';
    c.style.border = '1px solid #98A2B3';
    c.style.borderRadius = '6px';
    c.style.background = '#fff';
    box.current?.replaceChildren(c);
  }, [code, title, company]);

  function download() {
    const url = URL.createObjectURL(new Blob([labelsToZpl(SIZE, [{ code, title, footer: company }])], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${code}.zpl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setPrinted(true);
  }

  return (
    <section className="grid gap-3 rounded-control border-2 border-match p-3">
      <div ref={box} className="flex justify-center" />
      <button type="button" onClick={download} className="rounded-control border-2 border-rule-strong px-4 py-4 text-lg font-semibold">🖨 სტიკერის ბეჭდვა</button>
      <button
        type="button"
        onClick={onDone}
        className={`rounded-control px-4 py-4 text-lg font-semibold ${printed ? 'bg-match text-white' : 'border-2 border-rule text-ink-soft'}`}
      >
        📷 ფოტოს გადაღება
      </button>
    </section>
  );
}
