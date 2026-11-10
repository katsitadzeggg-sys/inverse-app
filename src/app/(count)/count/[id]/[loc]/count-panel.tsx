'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, inputClass } from '@/components/ui';
import Scanner from '../../scanner';
import {
  addEntry,
  bookShelves,
  shelfCodeList,
  findProducts,
  productCatalog,
  productGroups,
  nameProduct,
  setShelfQty,
  shelfBook,
  shelfCounts,
  type ProductHit,
} from '../../actions';
import { isOffline, keepCatalog, pendingEntries, queueEntry, storedCatalog } from '@/lib/outbox';
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

/** The product came in with only its code (no name in the book file). */
const noName = (p: ProductHit) =>
  p.name === p.sku || p.name === p.barcode || p.name.startsWith('ახალი · ');

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
  const [newPhotos, setNewPhotos] = useState<{ file: File; url: string; video?: boolean }[]>([]);
  // Correcting a product already counted here: Next sets its total instead of adding.
  const [editing, setEditing] = useState(false);
  // Products saved on this shelf, oldest first: "← Back" opens them again, newest first.
  const savedStack = useRef<ProductHit[]>([]);
  // A product that came with only its code: the counter may give it a name.
  const [fixName, setFixName] = useState('');
  // Book quantity per product on this shelf (empty when the manager hides it).
  const [book, setBook] = useState<Record<string, number>>({});
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
  const [last, setLast] = useState<{
    code: string;
    name: string;
    qty: number;
    product?: ProductHit;
  } | null>(null);
  // "Already counted on this shelf" — a notice on the screen until Next.
  const [dup, setDup] = useState<string | null>(null);
  // Lines saved here that are not a known product yet (new products), for the shelf total.
  const [extra, setExtra] = useState({ sku: 0, pcs: 0 });
  // Products kept on the phone, so a scan is recognised with no connection.
  const [catalog, setCatalog] = useState<ProductHit[]>([]);
  // Shelf codes of the company: a shelf label read by the camera is ignored.
  const [shelfCodes, setShelfCodes] = useState<Set<string>>(new Set());
  // Where each product is booked (shelf codes) — to catch items on the wrong shelf.
  type Home = { id: string; code: string; done: boolean };
  const [homes, setHomes] = useState<Map<string, Home[]>>(new Map());
  // "This belongs on K-02": count it here, or put it back there.
  const [misplaced, setMisplaced] = useState<{ product: ProductHit; shelves: Home[] } | null>(null);
  useEffect(() => {
    // Saved counts plus lines still waiting on the phone.
    Promise.all([
      shelfCounts(stocktakeId, locationId).catch(() => ({}) as Record<string, number>),
      pendingEntries(locationId),
    ]).then(([c, waiting]) => {
      const sum = { ...c };
      for (const j of waiting)
        if (j.input.productId)
          sum[j.input.productId] = (sum[j.input.productId] ?? 0) + j.input.quantity;
      setCounted(sum);
    });
    shelfCodeList()
      .then((c) => setShelfCodes(new Set(c.map((x) => x.toUpperCase()))))
      .catch(() => {});
    bookShelves(stocktakeId)
      .then((rows) => {
        const m = new Map<string, Home[]>();
        for (const r of rows)
          m.set(r.product_id, [
            ...(m.get(r.product_id) ?? []),
            { id: r.location_id, code: r.code, done: r.shelf_done },
          ]);
        setHomes(m);
      })
      .catch(() => {});
    shelfBook(stocktakeId, locationId)
      .then(setBook)
      .catch(() => {});
    productCatalog()
      .then((rows) => {
        setCatalog(rows);
        keepCatalog(rows);
      })
      .catch(() => storedCatalog().then(setCatalog));
  }, [stocktakeId, locationId]);

  /** Lookup in the products kept on the phone (no connection). */
  function localFind(q: string): ProductHit[] {
    const t = q.trim().toLowerCase();
    const exact = catalog.filter((p) => p.barcode === q.trim() || p.sku.toLowerCase() === t);
    if (exact.length) return exact;
    return catalog.filter((p) => p.name.toLowerCase().includes(t)).slice(0, 8);
  }
  const [pending, start] = useTransition();
  const qtyRef = useRef<HTMLInputElement>(null);
  // The last lookup came from the camera: whatever was read is a code, never a name.
  const scanned = useRef(false);
  // A code read while the previous product was still open; looked up once that one is saved.
  const pendingScan = useRef<string | null>(null);
  // A line is being saved: scans wait in pendingScan instead of being lost.
  const saving = useRef(false);
  // The queued code, looked up after the save has re-rendered (fresh state, not a stale closure).
  const [queuedScan, setQueuedScan] = useState<{ code: string; n: number } | null>(null);
  // The code that opened the current product (a re-read of it is +1, not a new product).
  const openedBy = useRef<string | null>(null);
  const openedAt = useRef(0);
  const justSaved = useRef<{ code: string; at: number } | null>(null);
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
    setEditing(false);
    setFixName('');
    setQty('1');
    setExpiryDate(exp ?? '');
    setExpiryUnknown(false);
    setProduct(p);
    setUnknown(null);
    setNewBarcode(null);
    setNewOpen(false);
    setHits(null);
    // Counted before on this shelf: say so; the new quantity is added to it.
    const before = counted[p.id];
    setMessage(null);
    // Booked only on other shelves: ask whether to count it here or put it back.
    const shelves = homes.get(p.id);
    if (!expiry && shelves?.length && !shelves.some((x) => x.id === locationId))
      setMisplaced({ product: p, shelves });
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
    // While a line is being saved, the scan waits and is looked up right after.
    if (saving.current) {
      if (scanned.current) pendingScan.current = raw;
      return;
    }
    // A question is on screen: scans wait.
    if (misplaced) return;
    if (scanned.current) {
      const now = Date.now();
      // Two codes in the picture at once must not ping-pong: the product just
      // saved is not reopened by its own code for 5 s, and a freshly opened
      // product is not replaced by another code for 1.5 s.
      if (justSaved.current && justSaved.current.code === code && now - justSaved.current.at < 5000)
        return;
      if (product && openedBy.current !== code && now - openedAt.current < 1500) return;
    }
    // A web address (a menu, an advert QR) is neither a shelf nor a product.
    if (/^(https?:\/\/|www\.)/i.test(code)) {
      setMessage({ tone: 'error', text: 'ეს ვებ-ლინკის QR-ია, პროდუქტი არ არის.' });
      return;
    }
    // A shelf's own QR is not a product.
    if (scanned.current && shelfCodes.has(code.toUpperCase())) {
      setMessage({ tone: 'error', text: `„${code}“ თაროს კოდია, პროდუქტი არ არის.` });
      return;
    }
    // The same item scanned again before Next: one more piece (a scan, not 🔍).
    if (
      scanned.current &&
      product &&
      (code === openedBy.current ||
        product.barcode === code ||
        product.sku.toLowerCase() === code.toLowerCase())
    ) {
      setQty((v) => String((Number(v) || 0) + 1));
      return;
    }
    if (scanned.current && newBarcode && newBarcode === code) {
      setQty((v) => String((Number(v) || 0) + 1));
      return;
    }
    // Another product scanned while one is open: the open one is saved first,
    // then the new one starts — no Next needed between products.
    if (scanned.current && (product || newBarcode) && !newOpen && !pendingScan.current) {
      pendingScan.current = raw;
      next();
      return;
    }
    // The new-product form is being filled in: a stray scan is ignored.
    if (scanned.current && newOpen) return;
    setQuery(q);
    start(async () => {
      const found = isOffline() ? localFind(q) : await findProducts(q).catch(() => localFind(q));
      const exact = found.find(
        (p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase(),
      );
      if (exact) {
        openedBy.current = code;
        openedAt.current = Date.now();
        return choose(exact, gs1?.expiry ?? null);
      }
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
    setNewPhotos([]);
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

  /** Correct a product counted on this shelf: its total is shown and replaced on save. */
  function startEdit(p: ProductHit) {
    if (saving.current) return;
    reset();
    setProduct(p);
    setEditing(true);
    setDup(null);
    setMessage(null);
    setQty(String(counted[p.id] ?? 0));
    openedBy.current = null;
    focusQty();
  }

  // "← Back" at the top of the page: one step back on the screen before leaving it.
  const backRef = useRef<() => boolean>(() => false);
  // Kept current after every render (it reads the latest screen state).
  useEffect(() => {
    backRef.current = () => {
      if (saving.current) return true;
      if (misplaced) {
        setMisplaced(null);
        return true;
      }
      if ((product && !editing) || newOpen) {
        cancel();
        return true;
      }
      // Step back to the product saved before the one on screen.
      while (savedStack.current.length) {
        const p = savedStack.current.pop()!;
        if (editing && product && p.id === product.id) continue;
        startEdit(p);
        return true;
      }
      if (editing) {
        cancel();
        return true;
      }
      return false;
    };
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ handled: boolean }>).detail;
      if (backRef.current()) d.handled = true;
    };
    window.addEventListener('count-back', on);
    return () => window.removeEventListener('count-back', on);
  }, []);

  /** Back out of the current product (or the new-product form) without saving. */
  function cancel() {
    pendingScan.current = null;
    openedBy.current = null;
    setDup(null);
    setMessage(null);
    reset();
  }

  function reset() {
    setEditing(false);
    setFixName('');
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
    // One save at a time: a second Next / scan during a save never saves twice.
    if (saving.current) return;
    // A check below fails → the queued scan is dropped (the open product stays on screen).
    const fail = (text: string) => {
      pendingScan.current = null;
      setMessage({ tone: 'error', text });
    };
    if (!product && newOpen && !newName.trim()) return fail('ჩაწერე დასახელება.');
    if (!product && newOpen && isOffline())
      return fail('ახალი პროდუქტი ინტერნეტის გარეშე ვერ ჩაიწერება. ჩაწერე, როცა ქსელი დაბრუნდება.');
    if (!product && newOpen && !newPhotos.length)
      return fail('📷 ახალი პროდუქტის ფოტო ან ვიდეო სავალდებულოა.');
    if (!product && !newBarcode && !newOpen && !unknown?.trim()) return fail('აირჩიე პროდუქტი.');
    if (qty === '' || !Number.isFinite(total) || total < 0) return fail('ჩაწერე რაოდენობა.');
    if (expiry && !expiryDate && !expiryUnknown)
      return fail('ჩაწერე ვარგისიანობის ვადა, ან მონიშნე „ვადა არ ჩანს“.');
    const exp = expiry && !expiryUnknown ? expiryDate : null;
    saving.current = true;
    start(async () => {
      try {
        await save();
      } finally {
        saving.current = false;
      }
    });
    async function save() {
      // The new product's photos go up first: the first is kept on the product,
      // all of them in the shelf's photos (the manager sees what was found).
      let photoPath: string | null = null;
      if (newOpen && newPhotos.length) {
        try {
          const supabase = createClient();
          const { data: me } = await supabase.auth.getUser();
          for (const ph of newPhotos) {
            // Photos are made small; a video goes up as it was filmed.
            const ext = ph.video ? (ph.file.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg';
            const body = ph.video ? ph.file : await shrinkPhoto(ph.file);
            const path = `${companyId}/${stocktakeId}/${locationId}/product-${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from('stocktake-media')
              .upload(path, body, {
                contentType: ph.video ? ph.file.type || 'video/mp4' : 'image/jpeg',
              });
            if (upErr) throw upErr;
            if (!ph.video && !photoPath) photoPath = path;
            // created_by is required by the row's access rule.
            await supabase.from('stocktake_media').insert({
              created_by: me.user?.id,
              company_id: companyId,
              stocktake_id: stocktakeId,
              location_id: locationId,
              path,
              kind: ph.video ? 'video' : 'photo',
              caption: `ახალი პროდუქტი: ${newName.trim()}${newCode.trim() ? ` · ${newCode.trim()}` : ''}`,
              taken_at: new Date().toISOString(),
            });
          }
        } catch (e) {
          return setMessage({
            tone: 'error',
            text: `ფოტო ვერ აიტვირთა: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      // A correction: the product's total on this shelf is replaced.
      if (editing && product) {
        const r = await setShelfQty(stocktakeId, locationId, product.id, total).catch(() => ({
          error: 'ვერ შეინახა. სცადე თავიდან.',
        }));
        if (r.error) return setMessage({ tone: 'error', text: r.error });
        setCounted((c) => ({ ...c, [product.id]: total }));
        setLast({ code: product.barcode ?? product.sku, name: product.name, qty: total, product });
        setMessage({ tone: 'info', text: `✓ ჩასწორდა: ${product.name} — ${total}` });
        reset();
        return;
      }
      // A product known only by its code gets the name the counter wrote.
      let shownName = product?.name;
      if (product && fixName.trim()) {
        const r = await nameProduct(product.id, fixName).catch(() => ({ notice: undefined }));
        if (r.notice) shownName = r.notice;
      }
      const input = {
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
      };
      let res: { error?: string | null };
      try {
        if (isOffline()) throw new TypeError('Failed to fetch');
        res = await addEntry(stocktakeId, locationId, input);
      } catch (e) {
        if (!isOffline(e) || newOpen) {
          res = {
            error: newOpen
              ? 'ახალი პროდუქტი ინტერნეტის გარეშე ვერ ჩაიწერება.'
              : 'ვერ შეინახა. სცადე თავიდან.',
          };
        } else {
          // No connection: kept on the phone, sent when the signal is back.
          await queueEntry(stocktakeId, locationId, input);
          res = {};
        }
      }
      if (res.error) {
        pendingScan.current = null;
        setMessage({ tone: 'error', text: res.error });
      } else {
        const batch = expiry
          ? ` · ${exp ? fmtDate(exp) : 'ვადა უცნობია'}${status && status !== 'ok' ? ` (${EXPIRY_LABEL[status]})` : ''}`
          : '';
        const savedName =
          shownName ?? (newOpen ? newName : newBarcode ? newName || newBarcode : unknown) ?? '';
        const savedCode = product
          ? (product.barcode ?? product.sku)
          : newOpen
            ? newCode
            : (newBarcode ?? '');
        const sum = (product ? (counted[product.id] ?? 0) : 0) + total;
        if (product) setCounted((c) => ({ ...c, [product.id]: sum }));
        else setExtra((x) => ({ sku: x.sku + 1, pcs: x.pcs + total }));
        setLast({ code: savedCode, name: savedName, qty: sum, product: product ?? undefined });
        // Remember the order of saves, so "← Back" can step back through them.
        if (product && savedStack.current.at(-1)?.id !== product.id)
          savedStack.current.push(product);
        setDup(null);
        setMessage(batch ? { tone: 'info', text: `✓ ${savedName} — ${total}${batch}` } : null);
        navigator.vibrate?.([40, 40, 40]);
        reset();
        if (openedBy.current) justSaved.current = { code: openedBy.current, at: Date.now() };
        openedBy.current = null;
        const queued = pendingScan.current;
        pendingScan.current = null;
        if (queued) setQueuedScan((q) => ({ code: queued, n: (q?.n ?? 0) + 1 }));
      }
    }
  }

  // The product scanned during the save: looked up now, with the screen already cleared.
  useEffect(() => {
    if (!queuedScan) return;
    scanned.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once per queued scan
    search(queuedScan.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedScan]);

  const chosen = product || newBarcode || newOpen || unknown !== null;

  // What was just read, on the camera picture itself; in the stock app with
  // the quantity and Next, so a whole shelf is counted without leaving the camera.
  const overlay = product ? (
    <div className="grid gap-3">
      <div>
        <p className="text-lg font-semibold leading-tight">
          {noName(product) ? 'დასახელება არ აქვს' : product.name}
        </p>
        <p className="text-sm leading-tight text-white/70">
          {product.barcode ?? product.sku} · {unitLabel(product.unit)}
          {book[product.id] != null && (
            <>
              {' '}
              · სიით: <b className="text-white">{book[product.id]}</b>
            </>
          )}
        </p>
        {expiry && expiryDate && (
          <p className="text-sm leading-tight text-white/90">ვადა {fmtDate(expiryDate)}</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {misplaced && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="grid w-full max-w-sm gap-4 rounded-2xl border-2 border-review bg-paper p-5 text-center">
            <p className="text-lg font-semibold">{misplaced.product.name}</p>
            <p className="text-base">
              სიით ეს პროდუქტი თარო{' '}
              <b className="text-2xl">{misplaced.shelves.map((x) => x.code).join(', ')}</b>-ზეა.
            </p>
            <button
              type="button"
              onClick={() => setMisplaced(null)}
              className="rounded-control bg-match px-4 py-4 text-lg font-semibold text-white"
            >
              ✓ დავთვალოთ და აქ დავტოვოთ
            </button>
            <button
              type="button"
              onClick={() => {
                const to = misplaced.shelves[0];
                setMisplaced(null);
                reset();
                setDup(null);
                setMessage({
                  tone: 'info',
                  text: to.done
                    ? `↩ გადაიტანე ${to.code}-ზე. ${to.code} უკვე დათვლილია — მენეჯერს უთხარი, რომ იქ დაამატოს.`
                    : `↩ გადაიტანე ${to.code}-ზე — იქ დაითვლება. აქ არ ჩაიწერა.`,
                });
              }}
              className="rounded-control border-2 border-rule-strong px-4 py-4 text-lg font-semibold"
            >
              ↩ არ დავთვალოთ — გადავიტანოთ {misplaced.shelves[0].code}-ზე
            </button>
          </div>
        </div>
      )}
      {dup && !misplaced && (
        // On top of the screen until Next (or a tap).
        <button
          type="button"
          onClick={() => setDup(null)}
          className="fixed inset-x-4 top-1/3 z-50 whitespace-pre-line rounded-2xl border-2 border-review bg-paper p-5 text-center text-xl font-semibold text-ink shadow-2xl"
        >
          ⚠ {dup}
        </button>
      )}
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-control border border-rule/70 p-4">
        {(() => {
          // Counted on this shelf so far: products (SKU) and pieces.
          const vals = Object.values(counted).filter((q) => q > 0);
          const sku = vals.length + extra.sku;
          const pcs = vals.reduce((a, q) => a + q, 0) + extra.pcs;
          return sku > 0 ? (
            <p className="-mt-1 text-right text-sm font-semibold text-ink">
              ამ თაროზე დათვლილია: <span className="text-match">{sku} SKU</span> ·{' '}
              <span className="text-match">{pcs} ც.</span>
            </p>
          ) : null;
        })()}
        {last && (
          // The last product saved on this shelf; a tap opens it to correct the quantity.
          <button
            type="button"
            disabled={!last.product}
            onClick={() => last.product && startEdit(last.product)}
            className="-mt-1 flex w-full min-w-0 items-center gap-2 text-left text-sm text-ink-soft"
          >
            <span className="min-w-0 flex-1 truncate">
              ბოლოს: <b className="text-ink">{last.name}</b> ·{' '}
              <b className="text-match">{last.qty}</b>
            </span>
            {last.product && (
              <span className="shrink-0 rounded-control border border-rule-strong px-2 py-1 text-xs">
                ✏ ჩასწორება
              </span>
            )}
          </button>
        )}
        {Object.keys(counted).length > 0 && (
          // Everything counted on this shelf, each line can be corrected.
          <details className="min-w-0 rounded-control border border-accent/50 bg-accent/5 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-accent">
              📋 დათვლილი ამ თაროზე — ჩასწორება
            </summary>
            <ul className="mt-2 grid gap-1">
              {Object.entries(counted)
                .filter(([, q]) => q > 0)
                .map(([id, q]) => {
                  const p = catalog.find((x) => x.id === id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        disabled={!p}
                        onClick={() => p && startEdit(p)}
                        className="flex w-full items-center gap-2 rounded-control border border-rule/70 px-3 py-2 text-left text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {p ? (noName(p) ? (p.barcode ?? p.sku) : p.name) : '…'}
                        </span>
                        <b className="text-match tabular-nums">{q}</b>
                        {book[id] != null && (
                          <span className="text-xs text-ink-faint tabular-nums">/ {book[id]}</span>
                        )}
                        <span className="text-xs">✏</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </details>
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
            pendingScan.current = null;
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
            {editing && product && (
              <p className="rounded-control border-2 border-review/70 bg-review/10 px-3 py-2 text-sm font-semibold">
                ✏ ჩასწორება: ჩაწერე სწორი რაოდენობა ამ თაროზე
              </p>
            )}
            {product && !cameraOn && (
              <p className="text-lg font-semibold">
                {noName(product) ? 'დასახელება არ აქვს' : product.name}
                <span className="block text-sm font-normal text-ink-faint">
                  {product.barcode ?? product.sku} · {unitLabel(product.unit)}
                  {book[product.id] != null && <> · სიით: {book[product.id]}</>}
                </span>
              </p>
            )}
            {product && noName(product) && !editing && (
              <input
                value={fixName}
                onChange={(e) => setFixName(e.target.value)}
                placeholder="დასახელება არ აქვს — ჩაწერე (არასავალდებულო)"
                className={`${inputClass} text-base`}
              />
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
                  ფოტო / ვიდეო (მინიმუმ ერთი)
                  <div className="flex flex-wrap gap-2">
                    {newPhotos.map((ph, i) => (
                      <button
                        key={ph.url}
                        type="button"
                        onClick={() => setNewPhotos((all) => all.filter((_, j) => j !== i))}
                        aria-label="წაშლა"
                        className="relative h-20 w-20 overflow-hidden rounded-md border border-rule-strong"
                      >
                        {ph.video ? (
                          <span className="grid h-full w-full place-items-center bg-black text-3xl">
                            🎥
                          </span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ph.url} alt="" className="h-full w-full object-cover" />
                        )}
                        <span className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1.5 text-xs text-white">
                          ✕
                        </span>
                      </button>
                    ))}
                    {newPhotos.length < 6 && (
                      <label
                        className={`grid h-20 cursor-pointer place-items-center rounded-md border-2 border-dashed px-3 text-center text-sm font-semibold text-ink ${newPhotos.length ? 'w-20 border-rule-strong' : 'flex-1 border-mismatch/70'}`}
                      >
                        <span>
                          <span className="block text-2xl">📷</span>
                          {newPhotos.length ? '+ კიდევ' : 'ფოტოს გადაღება'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (!f) return;
                            setNewPhotos((all) => [
                              ...all,
                              { file: f, url: URL.createObjectURL(f) },
                            ]);
                            setMessage(null);
                          }}
                        />
                      </label>
                    )}
                    {newPhotos.length < 6 && (
                      <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-md border-2 border-dashed border-rule-strong text-center text-sm font-semibold text-ink">
                        <span>
                          <span className="block text-2xl">🎥</span>
                          ვიდეო
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (!f) return;
                            if (f.size > 45 * 1048576)
                              return setMessage({
                                tone: 'error',
                                text: 'ვიდეო ძალიან დიდია (მაქს. 45 MB) — გადაიღე უფრო მოკლე.',
                              });
                            setNewPhotos((all) => [
                              ...all,
                              { file: f, url: URL.createObjectURL(f), video: true },
                            ]);
                            setMessage(null);
                          }}
                        />
                      </label>
                    )}
                  </div>
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

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={pending}
                className="rounded-control border-2 border-rule-strong px-4 py-4 text-lg font-semibold disabled:opacity-60"
              >
                ✕ გაუქმება
              </button>
              <button
                type="button"
                onClick={next}
                disabled={pending}
                className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper disabled:opacity-60"
              >
                {pending ? '…' : editing ? '✓ ჩასწორება' : 'შემდეგი →'}
              </button>
            </div>
          </div>
        )}

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </section>
      {!chosen && footer}
    </>
  );
}
