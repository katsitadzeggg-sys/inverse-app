'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, inputClass } from '@/components/ui';
import Scanner from '../../scanner';
import { addEntry, findProducts, productGroups, shelfCounts, type ProductHit } from '../../actions';
import ComboInput from '@/components/combo-input';
import SerialField from './serial-field';
import { scanFeedback } from '@/lib/haptic';
import { createClient } from '@/lib/supabase/client';

/** A camera photo made small enough to upload quickly (long side 1600 px, JPEG). */
async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) =>
    c.toBlob((b) => (b ? ok(b) : no(new Error('photo'))), 'image/jpeg', 0.85),
  );
}
import {
  EXPIRY_LABEL,
  expiryFromText,
  expiryStatus,
  fmtDate,
  parseGs1,
  type ExpiryStatus,
} from '@/lib/expiry';

const STATUS_TONE: Record<ExpiryStatus, string> = {
  expired: 'text-mismatch',
  d15: 'text-mismatch',
  d40: 'text-review',
  ok: 'text-match',
  unknown: 'text-ink-faint',
};

/** Reads the text of an expiry label photo on the phone, then finds the date in it. */
async function readExpiry(file: File): Promise<{ date: string | null; text: string }> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789./-: EXPBexpbUSYTOuseytoБГДОгодеснрк',
  });
  const { data } = await worker.recognize(file);
  await worker.terminate();
  return { date: expiryFromText(data.text), text: data.text.replace(/\s+/g, ' ').trim() };
}

const unitLabel = (u?: string | null) => (!u || u === 'pcs' ? 'ცალი' : u);

/**
 * Scan or search a product, enter how many, press Next. Quantities are in the
 * product's unit (pieces unless the book file said otherwise). A barcode that
 * is not on the list is counted anyway as a new product.
 */
export default function CountPanel({
  stocktakeId,
  locationId,
  expiry = false,
  countDate,
  companyId,
  footer = null,
}: {
  stocktakeId: string;
  locationId: string;
  companyId: string;
  /** "Check the shelf": shown only between products, not while one is being entered. */
  footer?: React.ReactNode;
  /** Expiry-date count: each line also needs the batch's expiry date. */
  expiry?: boolean;
  countDate?: string;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // New product form: opened when 🔍 finds nothing.
  const [newOpen, setNewOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newVariant, setNewVariant] = useState('');
  const [newUnit, setNewUnit] = useState('ცალი');
  const [newSerial, setNewSerial] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newNote, setNewNote] = useState('');
  // New product's photo (required): taken with the camera, uploaded on Next.
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newPhotoUrl, setNewPhotoUrl] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => {
    productGroups()
      .then(setGroups)
      .catch(() => {});
  }, []);
  const [qty, setQty] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  // Already counted on this shelf (product → qty), and the last line saved.
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [last, setLast] = useState<{ code: string; name: string; qty: number } | null>(null);
  // "Already counted on this shelf" — a notice on the screen until Next.
  const [dup, setDup] = useState<string | null>(null);
  useEffect(() => {
    shelfCounts(stocktakeId, locationId)
      .then(setCounted)
      .catch(() => {});
  }, [stocktakeId, locationId]);
  const [pending, start] = useTransition();
  const qtyRef = useRef<HTMLInputElement>(null);
  // The last lookup came from the camera: whatever was read is a code, never a name.
  const scanned = useRef(false);
  // Bumped to close the full-screen camera.
  const [closeCamera, setCloseCamera] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryUnknown, setExpiryUnknown] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const status = expiryUnknown
    ? 'unknown'
    : expiryDate
      ? expiryStatus(expiryDate, countDate)
      : null;

  const total = Number(qty.replace(',', '.'));

  function focusQty() {
    // Selected, so typing a number replaces the 1 instead of making it 15.
    setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 50);
  }

  // A scanned product starts at 1 piece; each repeat scan adds one.
  function choose(p: ProductHit, exp: string | null = null) {
    setQty('1');
    setExpiryDate(exp ?? '');
    setExpiryUnknown(false);
    setProduct(p);
    setUnknown(null);
    setNewBarcode(null);
    setHits(null);
    // Counted before on this shelf: say so; the new quantity is added to it.
    const before = counted[p.id];
    setMessage(null);
    setDup(
      before
        ? `უკვე დასკანერებულია: ${before} ${unitLabel(p.unit)}.\nახალი რაოდენობა დაემატება.`
        : null,
    );
    focusQty();
  }

  function search(raw: string) {
    // A GS1 DataMatrix / GS1-128 carries the GTIN and the expiry date (AI 17).
    const gs1 = parseGs1(raw);
    const q = gs1 ? gs1.ean : raw;
    const code = q.trim();
    if (
      gs1 &&
      expiry &&
      product &&
      product.barcode === code &&
      gs1.expiry &&
      gs1.expiry !== expiryDate
    ) {
      // Same product, another batch: start a new line for it.
      choose(product, gs1.expiry);
      return;
    }
    // The same item scanned again before Next: one more piece.
    if (product && (product.barcode === code || product.sku.toLowerCase() === code.toLowerCase())) {
      setQty((v) => String((Number(v) || 0) + 1));
      return;
    }
    if (newBarcode && newBarcode === code) {
      setQty((v) => String((Number(v) || 0) + 1));
      return;
    }
    setQuery(q);
    start(async () => {
      const found = await findProducts(q);
      const exact = found.find(
        (p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase(),
      );
      if (exact) return choose(exact, gs1?.expiry ?? null);
      setHits(found);
      setProduct(null);
      // Not found, or several to pick from: the camera steps aside for the form / the list.
      if (!found.length) openNew(q.trim());
      setCloseCamera((k) => k + 1);
    });
  }

  /** Nothing found: the new-product form, the code or the name already filled in. */
  function openNew(text: string) {
    const looksLikeCode = scanned.current || /^[A-Za-z0-9\-./]{4,30}$/.test(text);
    scanned.current = false;
    setNewCode(looksLikeCode ? text : '');
    setNewName(looksLikeCode ? '' : text);
    setNewVariant('');
    setNewSerial('');
    setNewNote('');
    setNewPhoto(null);
    setNewPhotoUrl(null);
    setNewUnit('ცალი');
    setQty('1');
    setExpiryDate('');
    setExpiryUnknown(false);
    setProduct(null);
    setNewBarcode(null);
    setUnknown(null);
    setHits(null);
    setMessage(null);
    setNewOpen(true);
  }

  function reset() {
    setNewOpen(false);
    setNewCode('');
    setNewVariant('');
    setProduct(null);
    setUnknown(null);
    setNewBarcode(null);
    setNewName('');
    setQuery('');
    setHits(null);
    setQty('');
    setExpiryDate('');
    setExpiryUnknown(false);
  }

  function next() {
    if (newOpen && !newName.trim())
      return setMessage({ tone: 'error', text: 'ჩაწერე დასახელება.' });
    if (newOpen && !newPhoto)
      return setMessage({ tone: 'error', text: '📷 ახალი პროდუქტის ფოტოს გადაღება სავალდებულოა.' });
    if (!product && !newBarcode && !newOpen && !unknown?.trim())
      return setMessage({ tone: 'error', text: 'აირჩიე პროდუქტი.' });
    if (qty === '' || !Number.isFinite(total) || total < 0)
      return setMessage({ tone: 'error', text: 'ჩაწერე რაოდენობა.' });
    if (expiry && !expiryDate && !expiryUnknown)
      return setMessage({
        tone: 'error',
        text: 'ჩაწერე ვარგისიანობის ვადა, ან მონიშნე „ვადა არ ჩანს“.',
      });
    const exp = expiry && !expiryUnknown ? expiryDate : null;
    start(async () => {
      // The new product's photo goes up first; its path is kept on the product.
      let photoPath: string | null = null;
      if (newOpen && newPhoto) {
        try {
          const jpeg = await shrinkPhoto(newPhoto);
          photoPath = `${companyId}/${stocktakeId}/${locationId}/product-${crypto.randomUUID()}.jpg`;
          const { error: upErr } = await createClient()
            .storage.from('stocktake-media')
            .upload(photoPath, jpeg, { contentType: 'image/jpeg' });
          if (upErr) throw upErr;
        } catch (e) {
          return setMessage({
            tone: 'error',
            text: `ფოტო ვერ აიტვირთა: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      const res = await addEntry(stocktakeId, locationId, {
        newPhoto: photoPath,
        productId: product?.id ?? null,
        unknownLabel: product || newBarcode || newOpen ? null : unknown,
        newBarcode: product ? null : newOpen ? newCode.trim() || null : newBarcode,
        newName: product ? null : newName,
        newUnit: product ? null : newOpen ? newUnit : null,
        newVariant: product ? null : newOpen ? newVariant : null,
        newSerial: product ? null : newOpen ? newSerial : null,
        newGroup: product ? null : newOpen ? newGroup : null,
        newNote: product ? null : newOpen ? newNote : null,
        quantity: total,
        boxes: null,
        perBox: null,
        expiryDate: exp,
      });
      if (res.error) setMessage({ tone: 'error', text: res.error });
      else {
        const batch = expiry
          ? ` · ${exp ? fmtDate(exp) : 'ვადა უცნობია'}${status && status !== 'ok' ? ` (${EXPIRY_LABEL[status]})` : ''}`
          : '';
        const savedName =
          product?.name ?? (newOpen ? newName : newBarcode ? newName || newBarcode : unknown) ?? '';
        const savedCode = product
          ? (product.barcode ?? product.sku)
          : newOpen
            ? newCode
            : (newBarcode ?? '');
        const sum = (product ? (counted[product.id] ?? 0) : 0) + total;
        if (product) setCounted((c) => ({ ...c, [product.id]: sum }));
        setLast({ code: savedCode, name: savedName, qty: sum });
        setDup(null);
        setMessage(batch ? { tone: 'info', text: `✓ ${savedName} — ${total}${batch}` } : null);
        navigator.vibrate?.([40, 40, 40]);
        reset();
      }
    });
  }

  const chosen = product || newBarcode || newOpen || unknown !== null;

  // What was just read, on the camera picture itself; in the stock app with
  // the quantity and Next, so a whole shelf is counted without leaving the camera.
  const overlay = product ? (
    <div className="grid gap-3">
      <div>
        <p className="text-lg font-semibold leading-tight">{product.name}</p>
        <p className="text-sm leading-tight text-white/70">
          {product.barcode ?? product.sku} · {unitLabel(product.unit)}
        </p>
        {expiry && expiryDate && (
          <p className="text-sm leading-tight text-white/90">ვადა {fmtDate(expiryDate)}</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {dup && (
        // On top of the screen until Next (or a tap).
        <button
          type="button"
          onClick={() => setDup(null)}
          className="fixed inset-x-4 top-1/3 z-50 whitespace-pre-line rounded-2xl border-2 border-review bg-paper p-5 text-center text-xl font-semibold text-ink shadow-2xl"
        >
          ⚠ {dup}
        </button>
      )}
      <section className="grid gap-3 rounded-control border border-rule/70 p-4">
        {last && (
          // The last product saved on this shelf, small, at the top.
          <p className="-mt-1 truncate text-sm text-ink-soft">
            ბოლოს დასკანერდა: <span className="text-ink-faint">{last.code}</span> ·{' '}
            <b className="text-ink">{last.name}</b> · <b className="text-match">{last.qty}</b>
          </p>
        )}
        <Scanner
          label="პროდუქტის სკანირება"
          onCode={(c) => {
            scanFeedback(); // buzz + beep: the code was read
            scanned.current = true;
            search(c);
          }}
          overlay={overlay}
          onOpenChange={setCameraOn}
          fullscreen={!expiry}
          shape="wide"
          closeKey={closeCamera}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            scanned.current = false; // typed, not scanned
            // 🔍 with nothing typed: straight to the new-product form.
            if (query.trim()) search(query);
            else openNew('');
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ან ჩაწერე შტრიხკოდი ან სახელი"
            className={`${inputClass} text-base`}
          />
          <button type="submit" className="rounded-control border border-rule-strong px-4">
            🔍
          </button>
        </form>

        {hits && hits.length > 0 && !product && (
          <ul className="grid gap-1">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  className="w-full rounded-control border border-rule px-3 py-2 text-left"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-ink-faint">{p.barcode ?? p.sku}</span>
                </button>
              </li>
            ))}
          </ul>
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
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="დასახელება"
                  className={`${inputClass} text-base`}
                />
              </div>
            )}
            {newOpen && !product && (
              <div className="grid gap-3 rounded-control border-2 border-review/70 p-3">
                <p className="text-lg font-semibold text-mismatch">ახალი პროდუქტი</p>
                <label className="grid gap-1 text-sm text-ink-soft">
                  დასახელება
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus={!newName}
                    placeholder="მაგ. ლიმონათი ზედაზენი"
                    className={`${inputClass} py-4 text-lg`}
                  />
                </label>
                <div className="grid gap-1 text-sm text-ink-soft">
                  ფოტო (სავალდებულო)
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-control border-2 px-3 py-3 text-lg font-semibold text-ink ${newPhoto ? 'border-match' : 'border-mismatch/70'}`}
                  >
                    {newPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={newPhotoUrl} alt="" className="h-16 w-16 rounded-md object-cover" />
                    ) : (
                      <span className="text-3xl">📷</span>
                    )}
                    {newPhoto ? '✓ გადაღებულია — შეცვლა' : 'ფოტოს გადაღება'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        setNewPhoto(f);
                        setNewPhotoUrl(URL.createObjectURL(f));
                        setMessage(null);
                      }}
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-sm text-ink-soft">
                  შტრიხკოდი
                  <input
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="თუ აქვს"
                    className={`${inputClass} py-4 text-lg`}
                  />
                </label>
                <div className="grid gap-1 text-sm text-ink-soft">
                  სერიული ნომერი
                  <SerialField value={newSerial} onChange={setNewSerial} ocr={false} />
                </div>
                <div className="grid gap-1 text-sm text-ink-soft">
                  ჯგუფი
                  <ComboInput
                    value={newGroup}
                    onChange={setNewGroup}
                    options={groups}
                    placeholder="მაგ. სასმელები"
                    className={`${inputClass} py-4 text-lg`}
                  />
                </div>
                <label className="grid gap-1 text-sm text-ink-soft">
                  კომენტარი
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    rows={2}
                    placeholder="დეტალები, ზომა, ფერი"
                    className={`${inputClass} text-lg`}
                  />
                </label>
                <div className="grid gap-1 text-sm text-ink-soft">
                  ერთეული
                  <div className="grid grid-cols-5 gap-1.5">
                    {['ცალი', 'კგ', 'ლ', 'ყუთი', 'შეკვრა'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setNewUnit(u)}
                        className={`rounded-control border-2 py-3 text-base font-semibold ${newUnit === u ? 'border-match text-match' : 'border-rule-strong text-ink-soft'}`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {unknown !== null && !product && !newBarcode && !newOpen && (
              <div className="grid gap-2">
                <p className="text-lg font-semibold text-mismatch">ახალი პროდუქტი</p>
                <input
                  value={unknown}
                  onChange={(e) => setUnknown(e.target.value)}
                  placeholder="დასახელება, ზომა, ფერი"
                  className={`${inputClass} text-base`}
                />
              </div>
            )}

            {expiry && (
              <div className="grid gap-2 rounded-control border border-rule/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">ვარგისიანობის ვადა</span>
                  {status && (
                    <span className={`text-sm font-semibold ${STATUS_TONE[status]}`}>
                      {EXPIRY_LABEL[status]}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={expiryDate}
                    disabled={expiryUnknown}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className={`${inputClass} text-base`}
                  />
                  <label className="cursor-pointer whitespace-nowrap rounded-control border border-rule-strong px-3 py-2 text-sm">
                    📷 წაკითხვა
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        setReading('ვკითხულობ ეტიკეტს…');
                        try {
                          const { date, text } = await readExpiry(f);
                          if (date) {
                            setExpiryDate(date);
                            setExpiryUnknown(false);
                            setReading(`წავიკითხე: ${fmtDate(date)}. შეამოწმე.`);
                          } else
                            setReading(
                              `თარიღი ვერ ვიპოვე${text ? ` („${text.slice(0, 40)}“)` : ''}. ჩაწერე ხელით.`,
                            );
                        } catch {
                          setReading('ვერ წავიკითხე. ჩაწერე ხელით.');
                        }
                      }}
                    />
                  </label>
                </div>
                {reading && <p className="text-xs text-ink-soft">{reading}</p>}
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    checked={expiryUnknown}
                    onChange={(e) => setExpiryUnknown(e.target.checked)}
                  />
                  ვადა არ ჩანს / არ აწერია
                </label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))}
                className="h-14 w-14 rounded-control border border-rule-strong text-2xl"
              >
                −
              </button>
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
              <button
                type="button"
                onClick={() => setQty(String((Number(qty) || 0) + 1))}
                className="h-14 w-14 rounded-control border border-rule-strong text-2xl"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={next}
              disabled={pending}
              className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper disabled:opacity-60"
            >
              {pending ? '…' : 'შემდეგი →'}
            </button>
          </div>
        )}

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </section>
      {!chosen && footer}
    </>
  );
}
