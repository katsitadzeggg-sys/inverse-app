'use client';

import { useRef, useState, useTransition } from 'react';
import { Alert, inputClass } from '@/components/ui';
import Scanner from '../../scanner';
import { addEntry, findProducts, type ProductHit } from '../../actions';

const unitLabel = (u?: string | null) => (!u || u === 'pcs' ? 'ცალი' : u);

/**
 * Scan or search a product, enter how many, press Next. Quantities are in the
 * product's unit (pieces unless the book file said otherwise). A barcode that
 * is not on the list is counted anyway as a new product.
 */
export default function CountPanel({ stocktakeId, locationId }: { stocktakeId: string; locationId: string }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [qty, setQty] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const qtyRef = useRef<HTMLInputElement>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const total = Number(qty.replace(',', '.'));

  function focusQty() {
    setTimeout(() => qtyRef.current?.focus(), 50);
  }

  function choose(p: ProductHit) {
    setQty('');
    setProduct(p);
    setUnknown(null);
    setNewBarcode(null);
    setHits(null);
    setMessage(null);
    focusQty();
  }

  function search(q: string) {
    const code = q.trim();
    // The same item scanned again before Next: one more piece.
    if (product && (product.barcode === code || product.sku.toLowerCase() === code.toLowerCase())) {
      setQty((v) => String((Number(v) || 0) + 1));
      navigator.vibrate?.(30);
      return;
    }
    if (newBarcode && newBarcode === code) {
      setQty((v) => String((Number(v) || 0) + 1));
      navigator.vibrate?.(30);
      return;
    }
    setQuery(q);
    start(async () => {
      const found = await findProducts(q);
      const exact = found.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase());
      if (exact) return choose(exact);
      setHits(found);
      setProduct(null);
      if (!found.length && /^\d{6,14}$/.test(q.trim())) {
        setNewBarcode(q.trim());
        setNewName('');
        setUnknown(null);
        setMessage(null);
        focusQty();
      } else if (!found.length) {
        setMessage({ tone: 'error', text: `„${q}“ ვერ მოიძებნა.` });
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
  }

  function next() {
    if (!product && !newBarcode && !unknown?.trim()) return setMessage({ tone: 'error', text: 'აირჩიე პროდუქტი.' });
    if (qty === '' || !Number.isFinite(total) || total < 0) return setMessage({ tone: 'error', text: 'ჩაწერე რაოდენობა.' });
    start(async () => {
      const res = await addEntry(stocktakeId, locationId, {
        productId: product?.id ?? null,
        unknownLabel: product || newBarcode ? null : unknown,
        newBarcode: product ? null : newBarcode,
        newName: product ? null : newName,
        quantity: total,
        boxes: null,
        perBox: null,
      });
      if (res.error) setMessage({ tone: 'error', text: res.error });
      else {
        setMessage({ tone: 'info', text: `✓ ${product?.name ?? (newBarcode ? newName || newBarcode : unknown)} — ${total}` });
        navigator.vibrate?.([40, 40, 40]);
        reset();
      }
    });
  }

  const chosen = product || newBarcode || unknown !== null;

  // What was just read, written on the camera picture itself.
  const overlay = product ? (
    <>
      <p className="truncate text-sm font-semibold leading-tight">{product.name}</p>
      <p className="text-xs leading-tight text-white/75">{product.barcode ?? product.sku} · {unitLabel(product.unit)}</p>
    </>
  ) : newBarcode ? (
    <>
      <p className="text-sm font-semibold leading-tight text-red-400">ახალი პროდუქტი</p>
      <p className="text-xs leading-tight text-white/75">{newBarcode} · ცალი</p>
    </>
  ) : null;

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      <Scanner label="პროდუქტის სკანირება" onCode={search} overlay={overlay} onOpenChange={setCameraOn} />
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
          placeholder="ან ჩაწერე შტრიხკოდი ან სახელი"
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
                <span className="block text-xs text-ink-faint">{p.barcode ?? p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!chosen && hits && hits.length === 0 && query && !/^\d{6,14}$/.test(query.trim()) && (
        <button type="button" onClick={() => setUnknown(query)} className="text-left text-sm text-ink-soft underline">
          ❓ ჩავწერო უცნობ პროდუქტად
        </button>
      )}

      {chosen && (
        <div className="grid gap-3">
          {product && !cameraOn && (
            <p className="text-lg font-semibold">
              {product.name}
              <span className="block text-sm font-normal text-ink-faint">
                {product.barcode ?? product.sku} · {unitLabel(product.unit)}
              </span>
            </p>
          )}
          {newBarcode && !product && (
            <div className="grid gap-2">
              {!cameraOn && (
                <>
                  <p className="text-lg font-semibold text-mismatch">ახალი პროდუქტი</p>
                  <p className="-mt-2 text-sm text-ink-faint">{newBarcode} · ცალი</p>
                </>
              )}
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="დასახელება" className={`${inputClass} text-base`} />
            </div>
          )}
          {unknown !== null && !product && !newBarcode && (
            <div className="grid gap-2">
              <p className="text-lg font-semibold text-mismatch">ახალი პროდუქტი</p>
              <input value={unknown} onChange={(e) => setUnknown(e.target.value)} placeholder="დასახელება, ზომა, ფერი" className={`${inputClass} text-base`} />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))} className="h-14 w-14 rounded-control border border-rule-strong text-2xl">−</button>
            <input
              ref={qtyRef}
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="next"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && next()}
              placeholder="0"
              className={`${inputClass} py-3 text-center text-2xl font-semibold`}
            />
            <button type="button" onClick={() => setQty(String((Number(qty) || 0) + 1))} className="h-14 w-14 rounded-control border border-rule-strong text-2xl">+</button>
          </div>

          <button type="button" onClick={next} disabled={pending} className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper disabled:opacity-60">
            {pending ? '…' : 'შემდეგი →'}
          </button>
        </div>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </section>
  );
}
