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
import LabelStep from './label-step';
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
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AssetHit[] | null>(null);
  // 🔍 with nothing typed: the register to scroll and filter by name.
  const [browse, setBrowse] = useState(false);
  const [filter, setFilter] = useState('');
  const [card, setCard] = useState<Card | null>(null);
  const [condition, setCondition] = useState<Condition>('good');
  const [responsible, setResponsible] = useState('');
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const [needsLabel, setNeedsLabel] = useState(false);
  // At least one photo of every asset before moving on.
  const [shots, setShots] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
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
  const [done, setDone] = useState<{ name: string; invNo: string; count: number } | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [labelDone, setLabelDone] = useState(false);
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
    setDone(null);
    setNote('');
    setNeedsLabel(false);
    setSavedId(h.checkedId);
    setLabelDone(false);
    setShots(0);
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
        const all = await browseRegister(stocktakeId, room);
        if (!all.length) return setMessage({ tone: 'error', text: 'რეესტრი ჩატვირთული არ არის.' });
        setMessage(null);
        setFilter('');
        setBrowse(true);
        setHits(all);
      });
      return;
    }
    setBrowse(false);
    setQuery(text);
    start(async () => {
      const found = await findAsset(stocktakeId, text);
      const exact = found.find((h) => h.invNo === upperLatin(mkhedruli(text.replace(/\s+/g, ''))));
      if (exact) return open(exact, !exact.registerId);
      if (found.length) return setHits(found);
      // Not in the register: a code-looking text is the number of a surplus asset.
      if (/^[\p{L}\d][\p{L}\d\-/.]{1,30}$/u.test(text)) surplus(upperLatin(text), false);
      else setMessage({ tone: 'error', text: `„${text}“ რეესტრში ვერ მოიძებნა.` });
    });
  }

  function save() {
    if (!card) return;
    // An asset without a number gets one now; it goes on its new QR label.
    const invNo = card.invNo || `N-${Date.now().toString().slice(-6)}`;
    if (invNo !== card.invNo) setCard({ ...card, invNo });
    start(async () => {
      const res = await saveAssetCheck(stocktakeId, locationId, {
        registerId: card.registerId,
        invNo,
        name: card.name,
        condition,
        responsible,
        serial,
        needsLabel,
        note,
        group,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
      });
      if (res.error) return setMessage({ tone: 'error', text: res.error });
      navigator.vibrate?.([40, 40, 40]);
      setSavedId(res.id ?? null);
      setMessage(null);
    });
  }

  function next() {
    if (card && savedId) {
      const count = sessionCount + 1;
      setSessionCount(count);
      setDone({ name: card.name, invNo: card.invNo, count });
      navigator.vibrate?.([60, 40, 60]);
    }
    setCard(null);
    setSavedId(null);
    setQuery('');
    setHits(null);
    setMessage(null);
    router.refresh(); // the room list below picks up the new asset
  }

  const normRoom = normKey;
  const moved = card && !card.surplus && card.room && normRoom(card.room) !== normRoom(room);

  // The saved item is already in `recorded` once the page refreshes.
  const itemNo = savedId && !card?.checkedId ? recorded : recorded + 1;

  return (
    <>
      <p className="text-center text-3xl font-semibold tabular-nums">
        ინვენტარი №{Math.max(1, itemNo)}
      </p>
      <section className="grid gap-3 rounded-control border border-rule/70 p-4">
        {!card && done && (
          <div className="grid gap-1 rounded-control border-2 border-match bg-match/10 p-4 text-center">
            <p className="text-3xl">✅</p>
            <p className="text-lg font-semibold">ჩაიწერა: {done.name}</p>
          </div>
        )}
        {!card && (
          <>
            {pos === null && (
              <LocationStatus pos={pos} onRetry={async () => setPos(await currentPosition(8000))} />
            )}
            <Scanner label="ეტიკეტის სკანირება" onCode={search} variant="big" />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                search(query);
              }}
              className="flex gap-2"
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="საინვენტარო №"
                className={`${inputClass} py-4 text-lg`}
              />
              <button
                type="submit"
                aria-label="ძებნა"
                className="w-16 shrink-0 rounded-control border border-rule-strong text-2xl"
              >
                🔍
              </button>
            </form>
            <button
              type="button"
              onClick={() => surplus('', true)}
              className="rounded-control border-2 border-rule-strong px-4 py-4 text-center text-lg font-semibold text-ink"
            >
              🏷 ეტიკეტი არ აქვს — ჩავწერო ახლად
            </button>
            {hits && browse && (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
                placeholder="ძებნა დასახელებით ან ნომრით"
                className={`${inputClass} py-3 text-base`}
              />
            )}
            {hits && (
              <ul className={`grid gap-1 ${browse ? 'max-h-[60vh] overflow-y-auto' : ''}`}>
                {(browse && filter.trim()
                  ? hits.filter((h) => `${h.name} ${h.invNo} ${h.serial ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
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

            {!savedId && (
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
                <ComboInput value={group} onChange={setGroup} options={groups} placeholder="ჯგუფი — მაგ. ავეჯი, კომპიუტერული ტექნიკა" />
                <ComboInput value={responsible} onChange={setResponsible} options={people} placeholder="პასუხისმგებელი პირი — აირჩიე ან ჩაწერე" />
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
                  aria-pressed={needsLabel}
                  onClick={() => setNeedsLabel((v) => !v)}
                  className={`flex items-center justify-center gap-2 rounded-control border-2 px-4 py-4 text-lg font-semibold ${needsLabel ? 'border-review bg-review/15 text-ink' : 'border-rule-strong text-ink-soft'}`}
                >
                  {needsLabel ? '✓' : '🏷'} სტიკერის ბეჭდვა
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
                    onClick={save}
                    disabled={pending || !card.name.trim()}
                    className="rounded-control bg-match px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
                  >
                    {pending ? '…' : '✓ შენახვა'}
                  </button>
                </div>
              </>
            )}

            {savedId && needsLabel && !labelDone && (
              <LabelStep
                code={card.invNo}
                title={card.name}
                company={company}
                onDone={() => setLabelDone(true)}
              />
            )}

            {savedId && (!needsLabel || labelDone) && (
              <>
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
              </>
            )}
          </div>
        )}

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </section>
    </>
  );
}
