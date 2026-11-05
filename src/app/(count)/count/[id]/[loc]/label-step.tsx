'use client';

import { useEffect, useRef, useState } from 'react';
import { drawLabel } from '@/lib/zebra';

const SIZE = { w: 38, h: 38 };

/**
 * Right after Save, for an asset that needs a sticker: the QR label as it will
 * print and one button that opens the phone's print dialog with only the label
 * on the page (38×38 mm). Then on to the photos, so the new sticker is in them.
 */
export default function LabelStep({ code, title, company, onDone }: { code: string; title: string; company: string; onDone: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = drawLabel(SIZE, { code, title, footer: company }).toDataURL('image/png');
    const t = setTimeout(() => setSrc(url), 0);
    return () => clearTimeout(t);
  }, [code, title, company]);

  function print() {
    setPrinted(true);
    window.print();
  }

  return (
    <section className="grid gap-3 rounded-control border-2 border-match p-3">
      {/* Page size only while this step is on screen. */}
      <style>{'@media print { @page { size: 38mm 38mm; margin: 0; } }'}</style>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img id="print-label" ref={img} src={src} alt={code} className="mx-auto w-40 rounded-md border border-rule-strong bg-white" />
      )}
      <button type="button" onClick={print} disabled={!src} className="rounded-control bg-match px-4 py-4 text-lg font-semibold text-white disabled:opacity-50">
        🖨 დაბეჭდვა
      </button>
      <button
        type="button"
        onClick={onDone}
        className={`rounded-control px-4 py-4 text-lg font-semibold ${printed ? 'border-2 border-match text-ink' : 'border-2 border-rule text-ink-soft'}`}
      >
        📷 ფოტოს გადაღება
      </button>
    </section>
  );
}
