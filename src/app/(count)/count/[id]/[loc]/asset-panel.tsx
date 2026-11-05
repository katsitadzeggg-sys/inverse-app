'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, inputClass } from '@/components/ui';
import LocationStatus from '@/components/location-status';
import { currentPosition } from '@/lib/geo';
import Scanner from '../../scanner';
import MediaUpload from './done/media-upload';
import { assetGroups, findAsset, responsibleNames, saveAssetCheck, type AssetHit } from '../../assets-actions';
import LabelStep from './label-step';

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
}: {
  stocktakeId: string;
  locationId: string;
  room: string;
  companyId: string;
  userId: string;
  author: string;
  company: string;
  branch: string | null;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AssetHit[] | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [condition, setCondition] = useState<Condition>('good');
  const [responsible, setResponsible] = useState('');
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const [needsLabel, setNeedsLabel] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null | undefined>(undefined);
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
    responsibleNames().then(setPeople).catch(() => {});
    assetGroups().then(setGroups).catch(() => {});
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
    setMessage(null);
  }

  function surplus(inv: string, label: boolean) {
    open({ registerId: null, invNo: inv, name: '', room: null, responsible: null, serial: null, checkedId: null, checkedRoom: null }, true);
    setNeedsLabel(label);
  }

  function search(q: string) {
    const text = q.trim();
    if (!text) return;
    setQuery(text);
    start(async () => {
      const found = await findAsset(stocktakeId, text);
      const exact = found.find((h) => h.invNo === text.replace(/\s+/g, '').toUpperCase());
      if (exact) return open(exact, !exact.registerId);
      if (found.length) return setHits(found);
      // Not in the register: a code-looking text is the number of a surplus asset.
      if (/^[\p{L}\d][\p{L}\d\-/.]{1,30}$/u.test(text)) surplus(text.toUpperCase(), false);
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
      setMessage({ tone: 'info', text: `✓ ${card.name} — ${res.notice}. გადაიღე ფოტოები.` });
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

  const normRoom = (s: string) => s.toUpperCase().replace(/[^A-Z0-9\u10D0-\u10FF]+/g, '');
  const moved = card && !card.surplus && card.room && normRoom(card.room) !== normRoom(room);

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      {!card && done && (
        <div className="grid gap-1 rounded-control border-2 border-match bg-match/10 p-4 text-center">
          <p className="text-3xl">✅</p>
          <p className="text-lg font-semibold">ჩაიწერა: {done.name}</p>
          <p className="text-sm text-ink-soft">{done.invNo} · ამ სესიაში {done.count}-ე ნივთი</p>
          <p className="mt-1 text-sm font-semibold">დაასკანერე შემდეგი ნივთი ↓</p>
        </div>
      )}
      {!card && (
        <>
          <LocationStatus pos={pos} onRetry={async () => setPos(await currentPosition(8000))} />
          <Scanner label="ეტიკეტის სკანირება" onCode={search} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
            className="flex gap-2"
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ან ჩაწერე საინვენტარო № ან სახელი" className={`${inputClass} text-base`} />
            <button type="submit" className="rounded-control border border-rule-strong px-4">🔍</button>
          </form>
          <button type="button" onClick={() => surplus('', true)} className="text-left text-sm text-ink-soft underline">
            🏷 ეტიკეტი არ აქვს — ჩავწერო ახლად
          </button>
          {hits && (
            <ul className="grid gap-1">
              {hits.map((h) => (
                <li key={h.invNo}>
                  <button type="button" onClick={() => open(h, !h.registerId)} className="w-full rounded-control border border-rule px-3 py-2 text-left">
                    <span className="font-medium">{h.name}</span>
                    <span className="block text-xs text-ink-faint">{h.invNo}{h.room ? ` · ${h.room}` : ''}{h.checkedId ? ' · ✓ უკვე ჩაწერილია' : ''}</span>
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
            {card.surplus && card.fromHistory ? (
              <>
                <p className="text-lg font-semibold">{card.name}</p>
                <p className="text-sm text-review">ამ რეესტრში არ არის — მონაცემები წინა აღწერიდან ჩაჯდა (ზედმეტად ჩაიწერება)</p>
              </>
            ) : card.surplus ? (
              <p className="text-lg font-semibold text-mismatch">რეესტრში არ არის (ზედმეტი) — შეავსე ხელით</p>
            ) : (
              <p className="text-lg font-semibold">{card.name}</p>
            )}
            <p className="text-sm text-ink-faint">
              {card.invNo || 'ნომერი მიენიჭება'}{card.room ? ` · რეესტრით: ${card.room}` : ''}
            </p>
            {moved && <p className="mt-1 text-sm font-semibold text-review">⚠ სხვა ოთახშია — ჩაიწერება როგორც გადაადგილებული</p>}
            {card.checkedId && !savedId && (
              <p className="mt-1 text-sm text-review">უკვე ჩაწერილია{card.checkedRoom ? ` (${card.checkedRoom})` : ''}. შენახვა განაახლებს.</p>
            )}
          </div>

          {!savedId && (
            <>
              {card.surplus && (
                <div className="grid gap-2">
                  <input value={card.invNo} onChange={(e) => setCard({ ...card, invNo: e.target.value.toUpperCase() })} placeholder="საინვენტარო № (თუ აქვს)" className={`${inputClass} text-base`} />
                  <input value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} placeholder="დასახელება, მარკა, ფერი" className={`${inputClass} text-base`} />
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
              <input value={group} onChange={(e) => setGroup(e.target.value)} list="asset-groups" placeholder="ჯგუფი — მაგ. ავეჯი, კომპიუტერული ტექნიკა" className={inputClass} />
              <datalist id="asset-groups">
                {groups.map((g) => <option key={g} value={g} />)}
              </datalist>
              <input value={responsible} onChange={(e) => setResponsible(e.target.value)} list="responsible-people" placeholder="პასუხისმგებელი პირი — აირჩიე ან ჩაწერე" className={inputClass} />
              <datalist id="responsible-people">
                {people.map((p) => <option key={p} value={p} />)}
              </datalist>
              <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="ქარხნული სერიული № (თუ ნივთზე აწერია)" className={inputClass} />
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="შენიშვნა (დაზიანება, დეტალები)" className={inputClass} />
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={needsLabel} onChange={(e) => setNeedsLabel(e.target.checked)} />
                🏷 სტიკერი დასაბეჭდია (ეტიკეტი აკლია)
              </label>
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <button type="button" onClick={next} className="rounded-control border border-rule-strong px-3 py-3 text-sm">გაუქმება</button>
                <button type="button" onClick={save} disabled={pending || !card.name.trim()} className="rounded-control bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-60">
                  {pending ? '…' : '✓ შენახვა'}
                </button>
              </div>
            </>
          )}

          {savedId && needsLabel && !labelDone && (
            <LabelStep code={card.invNo} title={card.name} company={company} onDone={() => setLabelDone(true)} />
          )}

          {savedId && (!needsLabel || labelDone) && (
            <>
              <p className="text-sm text-ink-soft">ფოტოები: საერთო ხედი, ეტიკეტი / სერიული ფირფიტა, დაზიანება. ვიდეო 10–20 წამი (მაქს. 50 MB).</p>
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
              />
              <button type="button" onClick={next} className="rounded-control bg-ink px-4 py-4 text-lg font-semibold text-paper">✓ დასრულება — შემდეგი ნივთი</button>
            </>
          )}
        </div>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </section>
  );
}
