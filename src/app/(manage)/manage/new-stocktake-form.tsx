'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Alert, inputClass } from '@/components/ui';
import { addressOf, currentPosition } from '@/lib/geo';
import { createStocktake, type FormState } from '@/app/(count)/count/actions';

const EMPTY: FormState = {};
const KINDS: [string, string][] = [
  ['stock', 'მარაგები'],
  ['expiry', 'ვადიანი პროდუქცია'],
  ['assets', 'ძირითადი საშუალებები'],
];

const LAST_SITE = 'inverse:last-site';

export type SiteOption = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Open a stocktake. The company is the one the person belongs to; the
 * warehouse / object comes from the manager's list, with its address and map
 * point. Without a saved address the phone's location fills it in. The
 * number (INV-2026-0001…) is given by the database.
 */
export default function NewStocktakeForm({
  kind = 'stock',
  kinds,
  companyName,
  sites,
  allowNewSite = true,
  fixed = false,
}: {
  kind?: string;
  kinds?: string[];
  companyName: string;
  sites: SiteOption[];
  allowNewSite?: boolean;
  /** Counter's form: company, module and date shown as fixed facts. */
  fixed?: boolean;
}) {
  const options = KINDS.filter(([k]) => !kinds || kinds.includes(k));
  const [state, action, pending] = useActionState(createStocktake, EMPTY);
  const [chosen, setChosen] = useState(options[0]?.[0] ?? 'stock');
  const [siteId, setSiteId] = useState(sites.length ? sites[0].id : 'new');
  const [branch, setBranch] = useState(sites[0]?.name ?? '');
  const [address, setAddress] = useState(sites[0]?.address ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number; accuracy?: number } | null>(
    sites[0]?.lat != null && sites[0]?.lng != null
      ? { lat: sites[0].lat!, lng: sites[0].lng! }
      : null,
  );
  const [locating, setLocating] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  // A lookup still running when another object is picked must not overwrite its address.
  const lookup = useRef(0);

  async function locate(fillAddress: boolean) {
    const mine = ++lookup.current;
    setLocating('ვადგენ მდებარეობას… (თუ ტელეფონი ნებართვას ითხოვს — დაუშვი)');
    const p = await currentPosition(8000);
    if (mine !== lookup.current) return;
    if (!p) {
      return setLocating(
        'მდებარეობა ვერ დადგინდა. iPhone: პარამეტრები → კონფიდენციალურობა → მდებარეობა → Safari → „გამოყენებისას“. ან ჩაწერე მისამართი ხელით — გახსნა მაინც შეიძლება.',
      );
    }
    setPoint(p);
    if (fillAddress) {
      setLocating('ვეძებ მისამართს…');
      const a = await addressOf(p.lat, p.lng);
      if (mine !== lookup.current) return;
      if (a) setAddress(a);
      setLocating(
        a ? null : 'წერტილი ჩაიწერა. მისამართი ვერ ვიპოვე — ჩაწერე ხელით ან დატოვე ცარიელი.',
      );
      return;
    }
    setLocating(null);
  }

  // No saved address for the chosen site: take it from where the phone is.
  useEffect(() => {
    if (address) return;
    const t = setTimeout(() => locate(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // The object picked last time comes up first (per device).
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_SITE);
    } catch {}
    if (!last || last === siteId || !sites.some((x) => x.id === last)) return;
    const t = setTimeout(() => pickSite(last), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickSite(id: string) {
    lookup.current++; // drop a location lookup in flight
    setLocating(null);
    setSiteId(id);
    try {
      if (id !== 'new') localStorage.setItem(LAST_SITE, id);
    } catch {}
    const s = sites.find((x) => x.id === id);
    setBranch(s?.name ?? '');
    setAddress(s?.address ?? '');
    setPoint(s && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
  }

  const canType = allowNewSite || sites.length === 0;
  // On the counter's phone the controls are large and easy to tap.
  // Stock counter app: bigger fields, no address to look at (it comes with the object).
  const stockUi = fixed && chosen === 'stock';
  const field = stockUi
    ? `${inputClass} py-5 text-xl`
    : fixed
      ? `${inputClass} py-3.5 text-lg`
      : inputClass;

  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      {!fixed && <p className="text-sm font-semibold">ახალი ინვენტარიზაცია</p>}
      <input type="hidden" name="client_name" value={companyName} />
      {fixed ? (
        <>
          {/* Counter: company, module and today's date are fixed, not editable. */}
          {options.length === 1 && <input type="hidden" name="kind" value={options[0][0]} />}
          <input type="hidden" name="count_date" value={today} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-control bg-paper-sunk px-3 py-1.5 text-xs">
            <dt className="text-ink-faint">კომპანია</dt>
            <dd className="font-semibold">{companyName}</dd>
            <dt className="text-ink-faint">მოდული</dt>
            <dd className="font-semibold">
              {options.length > 1 ? (
                <select
                  name="kind"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  className="rounded-control border border-rule-strong bg-paper px-2 py-1"
                >
                  {options.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                options[0]?.[1]
              )}
            </dd>
            <dt className="text-ink-faint">თარიღი</dt>
            <dd className="font-semibold">{new Date().toLocaleDateString('ka-GE')}</dd>
          </dl>
        </>
      ) : (
        <>
          <p className="text-sm">
            კომპანია: <b>{companyName}</b>
          </p>
          <label className="grid gap-1 text-sm">
            მოდული
            <select
              name="kind"
              defaultValue={options.some(([k]) => k === kind) ? kind : options[0]?.[0]}
              className={inputClass}
            >
              {options.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            თარიღი
            <input name="count_date" type="date" defaultValue={today} className={inputClass} />
          </label>
        </>
      )}

      <label className={`grid gap-1 ${stockUi ? 'text-base' : 'text-sm'}`}>
        საწყობი / ობიექტი
        {sites.length > 0 && (
          <select value={siteId} onChange={(e) => pickSite(e.target.value)} className={field}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {canType && <option value="new">+ სხვა (ხელით)</option>}
          </select>
        )}
      </label>
      {siteId === 'new' ? (
        <input
          name="branch"
          required
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="მაგ. ყაზბეგის საწყობი"
          className={field}
        />
      ) : (
        <input type="hidden" name="branch" value={branch} />
      )}

      {stockUi ? (
        <input type="hidden" name="address" value={address} />
      ) : (
        <label className="grid gap-1 text-sm">
          მისამართი
          <div className="flex gap-2">
            <input
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ავტომატურად ლოკაციიდან ან ხელით"
              className={field}
            />
            {/* Same "my location" target icon as in Google Maps. */}
            <button
              type="button"
              onClick={() => locate(true)}
              aria-label="ჩემი ლოკაცია"
              className="flex w-14 shrink-0 items-center justify-center rounded-control border border-rule-strong text-[#4285F4]"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
                <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />
              </svg>
            </button>
          </div>
        </label>
      )}

      <input type="hidden" name="lat" value={point?.lat ?? ''} />
      <input type="hidden" name="lng" value={point?.lng ?? ''} />
      {locating && !stockUi && <p className="text-sm text-ink-soft">{locating}</p>}

      {fixed && chosen === 'assets' && (
        <label className="grid gap-1 text-sm">
          ოთახი
          <input
            name="room"
            required
            autoComplete="off"
            placeholder="302, A-302, პირველი მარჯვენა"
            className={field}
          />
        </label>
      )}

      {state.error && <Alert>{state.error}</Alert>}
      <button
        type="submit"
        disabled={pending || !(siteId === 'new' ? branch.trim() : branch)}
        className={`rounded-control bg-match px-4 font-semibold text-white disabled:opacity-50 ${stockUi ? 'py-5 text-2xl' : 'py-4 text-xl'}`}
      >
        {pending ? 'იწყება…' : stockUi ? 'შემდეგი →' : '▶ დაწყება'}
      </button>
    </form>
  );
}
