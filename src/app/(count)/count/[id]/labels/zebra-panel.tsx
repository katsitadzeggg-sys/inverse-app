'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canPrintBluetooth,
  drawLabel,
  forgetPrinter,
  labelsToZpl,
  printZplBluetooth,
  type LabelData,
  type LabelSize,
} from '@/lib/zebra';

/** ZQ511 prints up to 72 mm wide (3" head); rolls come in these common sizes. */
const SIZES: { id: string; w: number; h: number }[] = [
  { id: '38x38', w: 38, h: 38 },
  { id: '50x25', w: 50, h: 25 },
  { id: '50x30', w: 50, h: 30 },
  { id: '50x50', w: 50, h: 50 },
  { id: '58x40', w: 58, h: 40 },
  { id: '70x50', w: 70, h: 50 },
  { id: '76x51', w: 76, h: 51 },
  { id: '76x127', w: 76, h: 127 },
];
const DEFAULT: Record<string, string> = { shelves: '50x50', products: '50x30', assets: '50x30' };
const MAX_PRINT = 1000;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/**
 * Label studio for the Zebra ZQ511: pick the roll size, filter, copies, see the
 * label as it prints, then print through the phone's print dialog (Zebra Print
 * service), straight over Bluetooth, as a .zpl file, or on A4 paper.
 */
export default function ZebraPanel({
  items,
  fileName,
  kind,
}: {
  items: LabelData[];
  fileName: string;
  kind: string;
}) {
  const sizeKey = `label-size-${kind}`;
  const [sizeId, setSizeId] = useState(DEFAULT[kind] ?? '50x30');
  const [custom, setCustom] = useState<LabelSize>({ w: 50, h: 30 });
  // The last size used on this device (read after the first render).
  useEffect(() => {
    const id = load(sizeKey);
    const [w, h] = load('label-size-custom')?.split('x') ?? [];
    /* eslint-disable react-hooks/set-state-in-effect */
    if (id) setSizeId(id);
    if (Number(w) && Number(h)) setCustom({ w: Number(w), h: Number(h) });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sizeKey]);
  const [q, setQ] = useState('');
  const [copies, setCopies] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [canBt] = useState(() => typeof window !== 'undefined' && canPrintBluetooth());
  const preview = useRef<HTMLDivElement>(null);

  const size: LabelSize =
    sizeId === 'custom' ? custom : (SIZES.find((s) => s.id === sizeId) ?? SIZES[2]);
  const okSize = size.w >= 15 && size.w <= 80 && size.h >= 10 && size.h <= 200;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    // "A-01 – A-20" (dash with spaces) or "A-01..A-20": a range of codes.
    const parts = t.split(/\s+[-–]\s+|\.\./);
    if (parts.length === 2 && parts[0] && parts[1]) {
      const [a, b] = parts;
      const cmp = (x: string, y: string) => x.localeCompare(y, 'ka', { numeric: true });
      const inRange = items.filter(
        (i) => cmp(i.code.toLowerCase(), a) >= 0 && cmp(i.code.toLowerCase(), b) <= 0,
      );
      if (inRange.length) return inRange;
    }
    return t ? items.filter((i) => `${i.code} ${i.title}`.toLowerCase().includes(t)) : items;
  }, [items, q]);
  const jobs = useMemo(
    () => list.flatMap((i) => Array.from({ length: copies }, () => i)),
    [list, copies],
  );

  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    if (!list.length || !okSize) return void el.replaceChildren();
    const c = drawLabel(size, list[0]);
    c.style.width = `${Math.min(size.w * 4, 320)}px`;
    c.style.border = '1px solid #98A2B3';
    c.style.borderRadius = '6px';
    c.style.background = '#fff';
    el.replaceChildren(c);
  }, [list, size, okSize]);

  function pickSize(id: string) {
    setSizeId(id);
    store(sizeKey, id);
  }
  function setCustomSize(s: LabelSize) {
    setCustom(s);
    store('label-size-custom', `${s.w}x${s.h}`);
  }

  /**
   * Prints through the browser: one label per page at the label's size (the
   * Zebra Print service on Android sends it to the printer), or a sheet of A4.
   */
  function printPages(a4: boolean) {
    if (!jobs.length || !okSize) return;
    if (jobs.length > MAX_PRINT) {
      setMsg(`ერთ ჯერზე მაქსიმუმ ${MAX_PRINT} — შეავიწროვე ძებნით (მაგ. A-01 – A-50).`);
      return;
    }
    setMsg('მზადდება…');
    document.getElementById('print-labels')?.remove();
    const box = document.createElement('div');
    box.id = 'print-labels';
    const cache = new Map<LabelData, string>();
    for (const d of jobs) {
      let src = cache.get(d);
      if (!src) {
        src = drawLabel(size, d).toDataURL('image/png');
        cache.set(d, src);
      }
      const img = document.createElement('img');
      img.src = src;
      box.append(img);
    }
    const style = document.createElement('style');
    style.id = 'print-labels-style';
    style.textContent = a4
      ? `#print-labels { display: none; }
         @media print { @page { size: A4; margin: 8mm; } body > *:not(#print-labels) { display: none !important; }
           #print-labels { display: flex !important; flex-wrap: wrap; gap: 2mm; }
           #print-labels img { width: ${size.w}mm; height: ${size.h}mm; outline: 0.2mm dashed #999; break-inside: avoid; } }`
      : `#print-labels { display: none; }
         @media print { @page { size: ${size.w}mm ${size.h}mm; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; }
           body > *:not(#print-labels) { display: none !important; }
           #print-labels { display: block !important; }
           #print-labels img { display: block; width: ${size.w}mm; height: ${size.h}mm; break-after: page; } }`;
    document.getElementById('print-labels-style')?.remove();
    document.body.append(box, style);
    const cleanup = () => {
      box.remove();
      style.remove();
      document.removeEventListener('visibilitychange', back);
    };
    // Android fires "afterprint" before the print service has drawn the pages,
    // so the labels stay until the user is back on the page.
    const back = () => {
      if (document.visibilityState === 'visible') setTimeout(cleanup, 1500);
    };
    document.addEventListener('visibilitychange', back);
    setTimeout(cleanup, 300_000);
    setMsg(null);
    setTimeout(() => window.print(), 100);
  }

  async function printBt() {
    setMsg('იბეჭდება…');
    try {
      await printZplBluetooth(labelsToZpl(size, jobs));
      setMsg(`✓ გაიგზავნა ${jobs.length} ეტიკეტი`);
    } catch (e) {
      forgetPrinter();
      setMsg(
        /cancel/i.test(String(e))
          ? 'პრინტერი არ აირჩიე — სცადე ისევ.'
          : `Bluetooth: ${String(e).slice(0, 120)} — გამოიყენე „🖨 ბეჭდვა“.`,
      );
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([labelsToZpl(size, jobs)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_${size.w}x${size.h}.zpl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const input = 'rounded-control border border-rule-strong bg-paper-sunk px-3 py-2 text-sm';
  return (
    <section className="no-print grid gap-4 rounded-control border border-rule/70 p-4">
      <div className="grid gap-2">
        <p className="text-sm font-semibold">ეტიკეტის ზომა (რულონი), მმ</p>
        <div className="flex flex-wrap gap-1.5">
          {[...SIZES, { id: 'custom', w: 0, h: 0 }].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickSize(s.id)}
              className={`rounded-control border px-2.5 py-1.5 text-sm tabular-nums ${sizeId === s.id ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}
            >
              {s.id === 'custom' ? 'სხვა' : `${s.w}×${s.h}`}
            </button>
          ))}
        </div>
        {sizeId === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={15}
              max={80}
              value={custom.w}
              onChange={(e) => setCustomSize({ ...custom, w: Number(e.target.value) })}
              className={`${input} w-20`}
              aria-label="სიგანე, მმ"
            />
            ×
            <input
              type="number"
              min={10}
              max={200}
              value={custom.h}
              onChange={(e) => setCustomSize({ ...custom, h: Number(e.target.value) })}
              className={`${input} w-20`}
              aria-label="სიმაღლე, მმ"
            />
            სიგანე × სიმაღლე
          </div>
        )}
        {!okSize && <p className="text-sm text-miss">ზომა: სიგანე 15–80, სიმაღლე 10–200 მმ.</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ძებნა ან დიაპაზონი: A-01 – A-20"
          className={input}
          aria-label="ფილტრი"
        />
        <label className="flex items-center gap-2 text-sm">
          ასლი თითოზე
          <input
            type="number"
            min={1}
            max={50}
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className={`${input} w-16`}
          />
        </label>
      </div>

      <div className="grid justify-items-start gap-1">
        <div ref={preview} />
        <p className="text-xs text-ink-faint">
          ასე დაიბეჭდება · {list.length} ეტიკეტი{copies > 1 ? ` × ${copies} = ${jobs.length}` : ''}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => printPages(false)}
          disabled={!jobs.length || !okSize}
          className="rounded-control bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-50"
        >
          🖨 Zebra-ზე ბეჭდვა ({jobs.length})
        </button>
        <button
          type="button"
          onClick={() => printPages(true)}
          disabled={!jobs.length || !okSize}
          className="rounded-control border border-rule-strong px-4 py-3 text-base font-medium disabled:opacity-50"
        >
          📄 A4 ფურცელზე
        </button>
        {canBt && (
          <button
            type="button"
            onClick={printBt}
            disabled={!jobs.length || !okSize}
            className="rounded-control border border-rule-strong px-4 py-3 text-sm disabled:opacity-50"
          >
            ⚡ Bluetooth-ით პირდაპირ
          </button>
        )}
        <button
          type="button"
          onClick={download}
          disabled={!jobs.length || !okSize}
          className="rounded-control border border-rule-strong px-4 py-3 text-sm disabled:opacity-50"
        >
          ⬇ ZPL ფაილი
        </button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <p className="text-xs text-ink-faint">
        „Zebra-ზე ბეჭდვა“ ხსნის ტელეფონის ბეჭდვის ფანჯარას: აირჩიე პრინტერი (Zebra Print) და
        ქაღალდის ზომად იგივე ზომა. ზომა ზუსტად რულონის ეტიკეტს უნდა ემთხვეოდეს.
      </p>
    </section>
  );
}
