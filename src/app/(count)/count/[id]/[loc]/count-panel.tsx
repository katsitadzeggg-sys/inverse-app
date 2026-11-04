'use client';

import { useRef, useState, useTransition } from 'react';
import { Alert, inputClass } from '@/components/ui';
import Scanner from '../../scanner';
import { addEntry, findProducts, type ProductHit } from '../../actions';

type Mode = 'pieces' | 'boxes';

/** Scan or search a product, enter how many, save. Then the next one. */
export default function CountPanel({ stocktakeId, locationId }: { stocktakeId: string; locationId: string }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  // Counting without a product list: an unknown scanned barcode.
  const [newBarcode, setNewBarcode] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<Mode>('pieces');
  const [qty, setQty] = useState('');
  const [boxes, setBoxes] = useState('');
  const [perBox, setPerBox] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const qtyRef = useRef<HTMLInputElement>(null);

  const total =
    mode === 'boxes' ? (Number(boxes) || 0) * (Number(perBox.replace(',', '.')) || 0) : Number(qty.replace(',', '.'));

  function choose(p: ProductHit) {
    setProduct(p);
    setUnknown(null);
    setNewBarcode(null);
    setHits(null);
    setMessage(null);
    setTimeout(() => qtyRef.current?.focus(), 50);
  }

  function search(q: string) {
    setQuery(q);
    start(async () => {
      const found = await findProducts(q);
      const exact = found.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase());
      if (exact) choose(exact);
      else {
        setHits(found);
        setProduct(null);
        if (!found.length && /^\d{6,14}$/.test(q.trim())) {
          // Not in the list: count it anyway under its barcode.
          setNewBarcode(q.trim());
          setNewName('');
          setUnknown(null);
          setMessage(null);
          setTimeout(() => qtyRef.current?.focus(), 50);
        } else if (!found.length) {
          setMessage({ tone: 'error', text: `„${q}“ სიაში ვერ მოიძებნა. შეგიძლია ჩაწერო უცნობ პროდუქტად.` });
        }
      }
    });
  }

  function reset() {
    setProduct(null);
    setUnknown(null);
    setNewBarcode(null);
    setNewName('');
    setQuery('');
    setHits(null);
    setQty('');
    setBoxes('');
    setPerBox('');
  }

  function save() {
    if (!product && !newBarcode && !unknown?.trim()) return setMessage({ tone: 'error', text: 'აირჩიე პროდუქტი.' });
    if (!Number.isFinite(total) || total < 0 || (mode === 'pieces' && qty === '')) {
      return setMessage({ tone: 'error', text: 'ჩაწერე რაოდენობა.' });
    }
    start(async () => {
      const res = await addEntry(stocktakeId, locationId, {
        productId: product?.id ?? null,
        unknownLabel: product || newBarcode ? null : unknown,
        newBarcode: product ? null : newBarcode,
        newName: product ? null : newName,
        quantity: total,
        boxes: mode === 'boxes' ? Number(boxes) || 0 : null,
        perBox: mode === 'boxes' ? Number(perBox.replace(',', '.')) || 0 : null,
      });
      if (res.error) setMessage({ tone: 'error', text: res.error });
      else {
        setMessage({ tone: 'info', text: `✓ ${product?.name ?? (newBarcode ? newName || newBarcode : unknown)} — ${total}` });
        navigator.vibrate?.([40, 40, 40]);
        reset();
      }
    });
  }

  const big = `${inputClass} text-lg py-3`;

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-base font-semibold">2. დაასკანერე პროდუქტი</p>
      <Scanner label="პროდუქტის სკანირება" onCode={search} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ან ჩაწერე ბარკოდი, კოდი ან სახელი"
          className={`${inputClass} text-base`}
        />
        <button type="submit" className="rounded-control border border-rule-strong px-4">🔍</button>
      </form>

      {hits && hits.length > 0 && !product && (
        <ul className="grid gap-1">
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => choose(p)} className="w-full rounded-control border border-rule px-3 py-2 text-left">
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-ink-faint">{p.sku}{p.variant ? ` · ${p.variant}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {newBarcode && !product && (
        <div className="grid gap-2 rounded-control border border-review/50 bg-review/5 p-3">
          <p className="text-sm">
            🆕 ახალი შტრიხკოდი <b>{newBarcode}</b> — სიაში არ არის, მაგრამ ჩაიწერება.
          </p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="დასახელება (არასავალდებულო)"
            className={`${inputClass} text-base`}
          />
        </div>
      )}

      {!product && !newBarcode && unknown === null && (
        <button type="button" onClick={() => { setUnknown(query); setHits(null); }} className="text-left text-sm text-ink-soft underline">
          ❓ სიაში არ არის — ჩავწერო უცნობ პროდუქტად
        </button>
      )}

      {unknown !== null && !product && (
        <input
          value={unknown}
          onChange={(e) => setUnknown(e.target.value)}
          placeholder="მოკლედ აღწერე: სახელი, ზომა, ფერი"
          className={`${inputClass} text-base`}
        />
      )}

      {(product || newBarcode || unknown !== null) && (
        <div className="grid gap-3 border-t border-rule/70 pt-3">
          {product && (
            <p className="text-lg font-semibold">
              {product.name}
              <span className="block text-sm font-normal text-ink-faint">{product.sku} · {product.unit === 'pcs' ? 'ცალი' : product.unit}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 text-sm">
            {(['pieces', 'boxes'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-control border px-3 py-2 ${mode === m ? 'border-ink bg-ink text-paper' : 'border-rule-strong'}`}
              >
                {m === 'pieces' ? 'ცალობით' : 'ყუთი × ცალი'}
              </button>
            ))}
          </div>

          {mode === 'pieces' ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))} className="h-14 w-14 rounded-control border border-rule-strong text-2xl">−</button>
              <input
                ref={qtyRef}
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                className={`${big} text-center text-2xl font-semibold`}
              />
              <button type="button" onClick={() => setQty(String((Number(qty) || 0) + 1))} className="h-14 w-14 rounded-control border border-rule-strong text-2xl">+</button>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} placeholder="ყუთი" className={`${big} text-center`} />
              <span className="text-xl">×</span>
              <input inputMode="decimal" value={perBox} onChange={(e) => setPerBox(e.target.value)} placeholder="ცალი" className={`${big} text-center`} />
              <p className="col-span-3 text-center text-ink-soft">სულ: <b className="text-ink">{Number.isFinite(total) ? total : 0}</b></p>
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" onClick={reset} className="rounded-control border border-rule-strong px-4 py-4">გაუქმება</button>
            <button type="button" onClick={save} disabled={pending} className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper disabled:opacity-60">
              {pending ? 'ინახება…' : 'შენახვა'}
            </button>
          </div>
        </div>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </section>
  );
}
