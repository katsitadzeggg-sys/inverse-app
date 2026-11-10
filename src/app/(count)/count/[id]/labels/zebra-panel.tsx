'use client';

import { useEffect, useRef, useState } from 'react';
import {
  canPrintBluetooth,
  drawLabel,
  forgetPrinter,
  labelsToZpl,
  printZplBluetooth,
  type LabelData,
} from '@/lib/zebra';

const SIZES = [
  { id: 'small', w: 38, h: 38, label: 'პატარა ≈ 38×38 მმ — ძირ. საშუალება' },
  { id: 'big', w: 76, h: 127, label: 'დიდი ≈ 76×127 მმ — თარო / ყუთი' },
  { id: 'custom', w: 50, h: 30, label: 'სხვა ზომა' },
];

/**
 * Labels for a Zebra printer (ZQ511): pick the label size, see the first label
 * as it will print, download a .zpl file and send it to the printer from the
 * Zebra phone app or a computer.
 */
export default function ZebraPanel({ items, fileName }: { items: LabelData[]; fileName: string }) {
  const [sizeId, setSizeId] = useState('small');
  const [custom, setCustom] = useState({ w: 50, h: 30 });
  const preview = useRef<HTMLDivElement>(null);
  const [bt, setBt] = useState<string | null>(null);
  // Known only in the browser (Chrome on Android has Web Bluetooth).
  const [canBt] = useState(() => typeof window !== 'undefined' && canPrintBluetooth());

  /** Android + Chrome: all labels straight to the Zebra over Bluetooth. */
  async function printBt() {
    setBt('იბეჭდება…');
    try {
      await printZplBluetooth(labelsToZpl(size, items));
      setBt(`✓ გაიგზავნა ${items.length} ეტიკეტი`);
    } catch (e) {
      forgetPrinter();
      setBt(
        /cancel/i.test(String(e))
          ? 'პრინტერი არ აირჩიე — სცადე ისევ.'
          : 'კავშირი ვერ დამყარდა: ჩართე პრინტერი და Bluetooth.',
      );
    }
  }
  const size = sizeId === 'custom' ? custom : SIZES.find((s) => s.id === sizeId)!;

  useEffect(() => {
    const el = preview.current;
    if (!el || !items.length || size.w < 15 || size.h < 15) return;
    const c = drawLabel(size, items[0]);
    c.style.width = `${size.w * 2.2}px`;
    c.style.border = '1px solid #98A2B3';
    c.style.borderRadius = '6px';
    c.style.background = '#fff';
    el.replaceChildren(c);
  }, [items, size.w, size.h]);

  function download() {
    const zpl = labelsToZpl(size, items);
    const url = URL.createObjectURL(new Blob([zpl], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_${size.w}x${size.h}.zpl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <section className="no-print grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="font-semibold">🦓 Zebra პრინტერისთვის (ZQ511)</p>
      <select
        value={sizeId}
        onChange={(e) => setSizeId(e.target.value)}
        className="rounded-control border border-rule-strong bg-paper-sunk px-3 py-2 text-sm"
        aria-label="ეტიკეტის ზომა"
      >
        {SIZES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {sizeId === 'custom' && (
        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min={15}
            max={80}
            value={custom.w}
            onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })}
            className="w-20 rounded-control border border-rule-strong bg-paper-sunk px-2 py-1.5"
            aria-label="სიგანე, მმ"
          />
          ×
          <input
            type="number"
            min={15}
            max={200}
            value={custom.h}
            onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })}
            className="w-20 rounded-control border border-rule-strong bg-paper-sunk px-2 py-1.5"
            aria-label="სიმაღლე, მმ"
          />
          მმ (სიგანე × სიმაღლე)
        </div>
      )}
      <div ref={preview} />
      {canBt && (
        <button
          type="button"
          onClick={printBt}
          disabled={!items.length}
          className="rounded-control bg-match px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          🖨 Bluetooth-ით ბეჭდვა ({items.length})
        </button>
      )}
      {bt && <p className="text-sm">{bt}</p>}
      <button
        type="button"
        onClick={download}
        disabled={!items.length}
        className="rounded-control bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-50"
      >
        ⬇ ZPL ფაილი ({items.length} ეტიკეტი)
      </button>
      <p className="text-xs text-ink-faint">
        ფაილი გახსენი Zebra-ს აპით (Printer Setup Utility → ფაილის გაგზავნა) ან კომპიუტერიდან Zebra
        Setup Utilities-ით. ზომა ზუსტად ეტიკეტის რულონს უნდა ემთხვეოდეს.
      </p>
    </section>
  );
}
