'use client';

import { useEffect, useState, useTransition } from 'react';
import { inputClass } from '@/components/ui';
import {
  findProducts,
  linkBarcode,
  sameMakerProducts,
  type ProductHit,
  type SameMaker,
} from '../../actions';

const num = (v: number) => v.toLocaleString('ka-GE', { maximumFractionDigits: 3 });

/**
 * A scanned code nobody knows is often a product that is already on the list
 * under another barcode (another supplier, an old code). Offers the same
 * maker's products on this stocktake's book — not yet counted first — and a
 * name search; picking one attaches the scanned code to it for good.
 */
export default function ExistingPicker({
  stocktakeId,
  code,
  onPick,
}: {
  stocktakeId: string;
  code: string;
  onPick: (p: ProductHit) => void;
}) {
  const [maker, setMaker] = useState<SameMaker[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    sameMakerProducts(stocktakeId, code)
      .then((r) => live && setMaker(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [stocktakeId, code]);

  function search(text: string) {
    setQ(text);
    if (text.trim().length < 2) return setHits([]);
    start(async () => setHits(await findProducts(text).catch(() => [])));
  }

  function pick(p: ProductHit) {
    setErr(null);
    start(async () => {
      if (code.trim()) {
        const r = await linkBarcode(p.id, code).catch(() => ({ error: 'ქსელის შეცდომა.' }));
        if (r.error) return setErr(r.error);
      }
      onPick(p);
    });
  }

  const row = (p: ProductHit, extra?: React.ReactNode) => (
    <button
      key={p.id}
      type="button"
      disabled={pending}
      onClick={() => pick(p)}
      className="grid gap-0.5 rounded-control border border-rule-strong bg-paper px-3 py-2 text-left disabled:opacity-60"
    >
      <span className="text-base font-medium text-ink">{p.name}</span>
      <span className="text-xs text-ink-faint">
        {p.barcode ?? p.sku}
        {extra}
      </span>
    </button>
  );

  return (
    <details className="rounded-control border border-rule-strong/70 p-2" open={maker.length > 0}>
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        🔗 ეს სიაში არსებული პროდუქტია? (სხვა ბარკოდით)
      </summary>
      <div className="mt-2 grid gap-2">
        {maker.length > 0 && (
          <>
            <p className="text-xs text-ink-soft">იმავე მწარმოებლის, ნაშთში მყოფი:</p>
            {maker.map((p) =>
              row(
                p,
                <>
                  {' · '}ნაშთი {num(p.book)}
                  {p.counted ? ` · დათვლილი ${num(p.counted)}` : ' · ჯერ არ დათვლილა'}
                </>,
              ),
            )}
          </>
        )}
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="ან მოძებნე სახელით"
          className={`${inputClass} text-base`}
        />
        {hits.map((p) => row(p))}
        {code.trim() && (
          <p className="text-xs text-ink-faint">
            არჩევისას {code.trim()} ამ პროდუქტს მეორე ბარკოდად მიებმება — შემდეგ სკანირებაზე
            პირდაპირ ის ამოვა.
          </p>
        )}
        {err && <p className="text-sm text-miss">{err}</p>}
      </div>
    </details>
  );
}
