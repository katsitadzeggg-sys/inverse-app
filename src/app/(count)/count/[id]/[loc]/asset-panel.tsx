'use client';

import { useEffect, useState, useTransition } from 'react';
import { mkhedruli, normKey, upperLatin } from '@/lib/text';
import { useRouter } from 'next/navigation';
import { Alert, inputClass } from '@/components/ui';
import LocationStatus from '@/components/location-status';
import { currentPosition } from '@/lib/geo';
import Scanner from '../../scanner';
import MediaUpload from './done/media-upload';
import {
  assetGroups,
  findAsset,
  browseRegister,
  responsibleNames,
  saveAssetCheck,
  type AssetHit,
} from '../../assets-actions';
import {
  canPrintBluetooth,
  canvasToZpl,
  drawLabel,
  forgetPrinter,
  printZplBluetooth,
} from '@/lib/zebra';
import {
  isOffline,
  keepRegister,
  onOutbox,
  pendingInRoom,
  queueCheck,
  storedRegister,
} from '@/lib/outbox';

const LABEL = { w: 38, h: 38 };
import SerialField from './serial-field';
import ComboInput from '@/components/combo-input';

type Condition = 'good' | 'damaged' | 'writeoff';
const CONDITIONS: { value: Condition; label: string; tone: string }[] = [
  { value: 'good', label: 'კარგი', tone: 'border-match text-match' },
  { value: 'damaged', label: 'დაზიანებული', tone: 'border-review text-review' },
  { value: 'writeoff', label: 'ჩამოსაწერი', tone: 'border-mismatch text-mismatch' },
];

type Card = AssetHit & { surplus: boolean };

/**
 * Fixed assets in one room: scan the label (or type the inventory number or
 * name), confirm what it is, mark its condition, then take photos (overall
 * view, label/serial plate, defects) and a video. Not in the register →
 * surplus. Found in a different room than the register says → moved.
 */
export default function AssetPanel({
  stocktakeId,
  locationId,
  room,
  companyId,
  userId,
  author,
  company,
  branch,
  recorded = 0,
  backHref,
  title,
  footer = null,
}: {
  stocktakeId: string;
  locationId: string;
  room: string;
  companyId: string;
  userId: string;
  author: string;
  company: string;
  branch: string | null;
  recorded?: number;
  backHref: string;
  title: string;
  /** Room controls, shown only between items. */
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AssetHit[] | null>(null);
  // 🔍 with nothing typed: the register to scroll and filter by name.
  const [browse, setBrowse] = useState(false);
  // "Manual entry": number / name typed, register list to pick from.
  const [manual, setManual] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [condition, setCondition] = useState<Condition>('good');
  const [responsible, setResponsible] = useState('');
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const [needsLabel, setNeedsLabel] = useState(false);
  // At least one photo of every asset before moving on.
  const [shots, setShots] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
  // Back from the photo step to the filled-in card.
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null | undefined>(
    undefined,
  );
  const router = useRouter();
  const [people, setPeople] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  // The last asset finished in this room, shown big until the next scan.
  const [labelDone, setLabelDone] = useState(false);
  // The register, also kept on the phone for lookups with no connection.
  const [reg, setReg] = useState<AssetHit[]>([]);
  // Assets of this room saved offline, still waiting to be sent.
  const [pendingHere, setPendingHere] = useState(0);
  useEffect(() => {
    browseRegister(stocktakeId, room)
      .then((r) => {
        setReg(r);
        keepRegister(stocktakeId, r);
      })
      .catch(() => storedRegister(stocktakeId).then(setReg));
    const count = () => pendingInRoom(locationId).then(setPendingHere);
    count();
    return onOutbox(count);
  }, [stocktakeId, room, locationId]);

  /** Lookup in the register kept on the phone (no connection). */
  function localFind(text: string): AssetHit[] {
    const code = upperLatin(mkhedruli(text.replace(/\s+/g, '')));
    const exact = reg.filter(
      (h) => h.invNo === code || (h.serial && upperLatin(h.serial) === code),
    );
    if (exact.length) return exact;
    const t = text.toLowerCase();
    return reg.filter((h) => h.name.toLowerCase().includes(t)).slice(0, 30);
  }

  useEffect(() => {
    currentPosition().then(setPos);
    responsibleNames()
      .then(setPeople)
      .catch(() => {});
    assetGroups()
      .then(setGroups)
      .catch(() => {});
  }, []);

  function open(h: AssetHit, surplus = false) {
    setCard({ ...h, surplus });
    setHits(null);
    setCondition('good');
    setResponsible(h.responsible ?? '');
    setSerial(h.serial ?? '');
    setGroup(h.group ?? '');
    setNote('');
    setNeedsLabel(false);
    setSavedId(h.checkedId);
    setLabelDone(false);
    setShots(0);
    setManual(false);
    setMessage(null);
  }

  function surplus(inv: string, label: boolean) {
    open(
      {
        registerId: null,
        invNo: inv,
        name: '',
        room: null,
        responsible: null,
        serial: null,
        checkedId: null,
        checkedRoom: null,
      },
      true,
    );
    setNeedsLabel(label);
  }

  function search(q: string) {
    const text = q.trim();
    if (!text) {
      start(async () => {
        const all = await browseRegister(stocktakeId, room).catch(() => reg);
        if (!all.length) return;
        setMessage(null);
        setBrowse(true);
        setHits(all);
      });
      return;
    }
    setBrowse(false);
    setQuery(text);
    start(async () => {
      const found = await findAsset(stocktakeId, text).catch((e) => {
        if (isOffline(e)) return localFind(text);
        throw e;
      });
      const exact = found.find((h) => h.invNo === upperLatin(mkhedruli(text.replace(/\s+/g, ''))));
      if (exact) return open(exact, !exact.registerId);
      if (found.length) return setHits(found);
      // Not in the register: a code-looking text is the number of a surplus asset.
      if (/^[\p{L}\d][\p{L}\d\-/.]{1,30}$/u.test(text)) surplus(upperLatin(text), false);
      else setMessage({ tone: 'error', text: `„${text}“ რეესტრში ვერ მოიძებნა.` });
    });
  }

  function save(label = needsLabel) {
    if (!card) return;
    // An asset without a number gets one now; it goes on its new QR label.
    const invNo = card.invNo || `N-${Date.now().toString().slice(-6)}`;
    if (invNo !== card.invNo) setCard({ ...card, invNo });
    const input = {
      registerId: card.registerId,
      invNo,
      name: card.name,
      condition,
      responsible,
      serial,
      needsLabel: label,
      note,
      group,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
    };
    start(async () => {
      let res: { error?: string | null; id?: string };
      try {
        res = isOffline()
          ? { id: await queueCheck(stocktakeId, locationId, input) }
          : await saveAssetCheck(stocktakeId, locationId, input);
      } catch (e) {
        if (!isOffline(e))
          return setMessage({ tone: 'error', text: 'ვერ შეინახა. სცადე თავიდან.' });
        // No connection: kept on the phone, sent when the signal is back.
        res = { id: await queueCheck(stocktakeId, locationId, input) };
      }
      if (res.error) return setMessage({ tone: 'error', text: res.error });
      navigator.vibrate?.([40, 40, 40]);
      setSavedId(res.id ?? null);
      setEditing(false);
      setMessage(null);
    });
  }

  /**
   * "Print sticker": the phone's print dialog opens at once with only the QR
   * label on the page (38×38 mm); meanwhile the asset is saved, and back from
   * the dialog the counter is on the photo / video step.
   */
  function printAndSave() {
    if (!card || !card.name.trim()) return;
    const invNo = card.invNo || `N-${Date.now().toString().slice(-6)}`;
    if (invNo !== card.invNo) setCard({ ...card, invNo });
    // Android + Chrome: straight to the Zebra printer over Bluetooth, no dialog.
    if (canPrintBluetooth()) {
      const label = drawLabel(LABEL, { code: invNo, title: card.name, footer: company });
      setMessage({ tone: 'info', text: '🖨 იბეჭდება…' });
      printZplBluetooth(canvasToZpl(label))
        .then(() => {
          setMessage({ tone: 'info', text: '✓ სტიკერი დაიბეჭდა' });
          setNeedsLabel(true);
          setLabelDone(true);
        })
        .catch((e: unknown) => {
          forgetPrinter();
          const why = e instanceof Error ? e.message : String(e);
          setMessage({
            tone: 'error',
            text: /cancel/i.test(why)
              ? 'პრინტერი არ აირჩიე. დააჭირე ისევ და სიიდან აირჩიე Zebra.'
              : 'პრინტერთან კავშირი ვერ დამყარდა: ჩართე პრინტერი და Bluetooth, და სცადე ისევ.',
          });
        });
      if (savedId && !editing) return;
      save(true);
      return;
    }
    document.getElementById('print-label')?.remove();
    const img = document.createElement('img');
    img.id = 'print-label';
    img.src = drawLabel(LABEL, { code: invNo, title: card.name, footer: company }).toDataURL(
      'image/png',
    );
    img.style.display = 'none';
    const page = document.createElement('style');
    page.textContent =
      '@media print { @page { size: 38mm 38mm; margin: 0; } #print-label { display: block !important; } }';
    document.body.append(img, page);
    const cleanup = () => {
      img.remove();
      page.remove();
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 120_000);
    setNeedsLabel(true);
    setLabelDone(true);
    img
      .decode()
      .catch(() => {})
      .finally(() => window.print());
    if (savedId && !editing) return;
    save(true);
  }

  function next() {
    if (card && savedId) navigator.vibrate?.([60, 40, 60]);
    setCard(null);
    setSavedId(null);
    setEditing(false);
    setQuery('');
    setManual(false);
    setHits(null);
    setMessage(null);
    if (!isOffline()) router.refresh(); // the item count picks up the new asset
  }

  const normRoom = normKey;
  const moved = card && !card.surplus && card.room && normRoom(card.room) !== normRoom(room);

  // Back one step, keeping what was filled in: photos → card → scan → the stocktake.
  function back() {
    if (card && savedId && !editing) return setEditing(true);
    if (card && !savedId) return next();
    if (card && editing) return setEditing(false);
    if (manual) {
      setManual(false);
      setHits(null);
      return setQuery('');
    }
    router.push(backHref);
  }

  // The saved item is already in `recorded` once the page refreshes.
  const itemNo = (savedId && !card?.checkedId ? recorded : recorded + 1) + pendingHere;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
        >
          ← დაბრუნება
        </button>
        <h1 className="truncate text-2xl font-semibold">{title}</h1>
      </div>
      <p className="text-center text-3xl font-semibold tabular-nums">
        ინვენტარი №{Math.max(1, itemNo)}
      </p>
      <section className="grid gap-3 rounded-control border border-rule/70 p-4">
        {!card && (
          <>
            {pos === null && (
              <LocationStatus pos={pos} onRetry={async () => setPos(await currentPosition(8000))} />
            )}
            <Scanner label="ეტიკეტის სკანირება" onCode={search} variant="big" />
            {!manual ? (
              <button
                type="button"
                onClick={() => {
                  setManual(true);
                  search('');
                }}
                className="rounded-control border-2 border-rule-strong px-4 py-4 text-center text-lg font-semibold text-ink"
              >
                ✍ ხელით შევსება
              </button>
            ) : (
              <>
                {/* Typing filters the register; Enter looks the number up. */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    search(query);
                  }}
                >
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    enterKeyHint="search"
                    placeholder="ნომერი ან დასახელება"
                    className={`${inputClass} py-4 text-lg`}
                  />
                </form>
                <button
                  type="button"
                  onClick={() =>
                    surplus(
                      /^[\p{L}\d][\p{L}\d\-/.]{1,30}$/u.test(query.trim())
                        ? upperLatin(query.trim())
                        : '',
                      true,
                    )
                  }
                  className="rounded-control border-2 border-rule-strong px-4 py-3 text-center text-base font-semibold text-ink"
                >
                  ＋ რეესტრში არ არის — ახალი ნივთი
                </button>
              </>
            )}
            {hits && (
              <ul className={`grid gap-1 ${browse ? 'max-h-[60vh] overflow-y-auto' : ''}`}>
                {(browse && query.trim()
                  ? hits.filter((h) =>
                      `${h.name} ${h.invNo} ${h.serial ?? ''}`
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
                    )
                  : hits
                ).map((h) => (
                  <li key={h.invNo}>
                    <button
                      type="button"
                      onClick={() => open(h, !h.registerId)}
                      className="w-full rounded-control border border-rule px-3 py-2 text-left"
                    >
                      <span className="font-medium">{h.name}</span>
                      <span className="block text-xs text-ink-faint">
                        {h.invNo}
                        {h.room ? ` · ${h.room}` : ''}
                        {h.checkedId ? ' · ✓ უკვე ჩაწერილია' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {card && (
          <div className="grid gap-3">
            <div>
              {card.surplus ? (
                <p className="text-xl font-semibold text-mismatch">აღმოჩენილი მეტობა</p>
              ) : (
                <p className="text-lg font-semibold">{card.name}</p>
              )}
              {!card.surplus && (
                <p className="text-sm text-ink-faint">
                  {card.invNo}
                  {card.room ? ` · რეესტრით: ${card.room}` : ''}
                </p>
              )}
              {moved && (
                <p className="mt-1 text-sm font-semibold text-review">
                  ⚠ სხვა ოთახშია — ჩაიწერება როგორც გადაადგილებული
                </p>
              )}
              {card.checkedId && !savedId && (
                <p className="mt-1 text-sm text-review">
                  უკვე ჩაწერილია{card.checkedRoom ? ` (${card.checkedRoom})` : ''}. შენახვა
                  განაახლებს.
                </p>
              )}
            </div>

            {(!savedId || editing) && (
              <>
                {card.surplus && (
                  <div className="grid gap-2">
                    <input
                      value={card.invNo}
                      onChange={(e) => setCard({ ...card, invNo: upperLatin(e.target.value) })}
                      placeholder="საინვენტარო № (თუ აქვს)"
                      className={`${inputClass} text-base`}
                    />
                    <input
                      value={card.name}
                      onChange={(e) => setCard({ ...card, name: e.target.value })}
                      placeholder="დასახელება, მარკა, ფერი"
                      className={`${inputClass} text-base`}
                    />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCondition(c.value)}
                      className={`rounded-control border-2 px-2 py-3 text-sm font-semibold ${condition === c.value ? c.tone : 'border-rule text-ink-soft'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <ComboInput
                  value={group}
                  onChange={setGroup}
                  options={groups}
                  placeholder="ჯგუფი — მაგ. ავეჯი, კომპიუტერული ტექნიკა"
                />
                <ComboInput
                  value={responsible}
                  onChange={setResponsible}
                  options={people}
                  placeholder="პასუხისმგებელი პირი — აირჩიე ან ჩაწერე"
                />
                <SerialField value={serial} onChange={setSerial} />
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="შენიშვნა (დაზიანება, დეტალები)"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={printAndSave}
                  disabled={pending || !card.name.trim()}
                  className={`flex items-center justify-center gap-2 rounded-control border-2 px-4 py-4 text-lg font-semibold disabled:opacity-50 ${labelDone ? 'border-match text-ink' : 'border-rule-strong text-ink'}`}
                >
                  🖨 სტიკერის ბეჭდვა{labelDone ? ' ✓' : ''}
                </button>
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button
                    type="button"
                    onClick={next}
                    className="rounded-control bg-mismatch px-3 py-4 text-base font-semibold text-white"
                  >
                    გაუქმება
                  </button>
                  <button
                    type="button"
                    onClick={() => save()}
                    disabled={pending || !card.name.trim()}
                    className="rounded-control bg-match px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
                  >
                    {pending ? '…' : '✓ შენახვა'}
                  </button>
                </div>
              </>
            )}

            {savedId && (
              <div className={editing ? 'hidden' : 'grid gap-3'}>
                <MediaUpload
                  key={savedId}
                  stocktakeId={stocktakeId}
                  locationId={locationId}
                  companyId={companyId}
                  userId={userId}
                  author={author}
                  company={company}
                  branch={branch}
                  shelf={room}
                  items={[]}
                  assetCheckId={savedId}
                  extra={`${card.invNo} · ${card.name}`.slice(0, 80)}
                  compact
                  onUploaded={() => setShots((n) => n + 1)}
                />
                <button
                  type="button"
                  onClick={next}
                  disabled={shots === 0}
                  className="rounded-control bg-match px-4 py-4 text-lg font-semibold text-white disabled:bg-transparent disabled:text-ink-faint disabled:border-2 disabled:border-rule"
                >
                  {shots === 0 ? '📷 ჯერ ფოტო' : '✓ დასრულება — შემდეგი ნივთი'}
                </button>
              </div>
            )}
          </div>
        )}

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </section>
      {!card && footer}
    </>
  );
}
