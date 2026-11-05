'use client';

import { useActionState, useEffect, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { addressOf, currentPosition, mapsLink } from '@/lib/geo';
import { createStocktake, type FormState } from '@/app/(count)/count/actions';

const EMPTY: FormState = {};
const KINDS: [string, string][] = [['stock', 'მარაგები'], ['expiry', 'ვადიანი პროდუქცია'], ['assets', 'ძირითადი საშუალებები']];

export type SiteOption = { id: string; name: string; address: string | null; lat: number | null; lng: number | null };

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
  const [siteId, setSiteId] = useState(sites.length ? sites[0].id : 'new');
  const [branch, setBranch] = useState(sites[0]?.name ?? '');
  const [address, setAddress] = useState(sites[0]?.address ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number; accuracy?: number } | null>(
    sites[0]?.lat != null && sites[0]?.lng != null ? { lat: sites[0].lat!, lng: sites[0].lng! } : null,
  );
  const [locating, setLocating] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function locate(fillAddress: boolean) {
    setLocating('ვადგენ მდებარეობას… (თუ ტელეფონი ნებართვას ითხოვს — დაუშვი)');
    const p = await currentPosition(8000);
    if (!p) {
      return setLocating('მდებარეობა ვერ დადგინდა. iPhone: პარამეტრები → კონფიდენციალურობა → მდებარეობა → Safari → „გამოყენებისას“. ან ჩაწერე მისამართი ხელით — გახსნა მაინც შეიძლება.');
    }
    setPoint(p);
    if (fillAddress) {
      setLocating('ვეძებ მისამართს…');
      const a = await addressOf(p.lat, p.lng);
      if (a) setAddress(a);
      setLocating(a ? null : 'წერტილი ჩაიწერა. მისამართი ვერ ვიპოვე — ჩაწერე ხელით ან დატოვე ცარიელი.');
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

  function pickSite(id: string) {
    setSiteId(id);
    const s = sites.find((x) => x.id === id);
    setBranch(s?.name ?? '');
    setAddress(s?.address ?? '');
    setPoint(s && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
  }

  const canType = allowNewSite || sites.length === 0;

  return (
    <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-sm font-semibold">ახალი ინვენტარიზაცია</p>
      <input type="hidden" name="client_name" value={companyName} />
      {fixed ? (
        <>
          {/* Counter: company, module and today's date are fixed, not editable. */}
          {options.length === 1 && <input type="hidden" name="kind" value={options[0][0]} />}
          <input type="hidden" name="count_date" value={today} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-paper-sunk px-3 py-2 text-sm">
            <dt className="text-ink-faint">კომპანია</dt><dd className="font-semibold">{companyName}</dd>
            <dt className="text-ink-faint">მოდული</dt>
            <dd className="font-semibold">
              {options.length > 1 ? (
                <select name="kind" defaultValue={options[0]?.[0]} className="rounded-control border border-rule-strong bg-paper px-2 py-1">
                  {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              ) : options[0]?.[1]}
            </dd>
            <dt className="text-ink-faint">თარიღი</dt><dd className="font-semibold">{new Date().toLocaleDateString('ka-GE')}</dd>
          </dl>
        </>
      ) : (
        <>
          <p className="text-sm">კომპანია: <b>{companyName}</b></p>
          <label className="grid gap-1 text-sm">
            მოდული
            <select name="kind" defaultValue={options.some(([k]) => k === kind) ? kind : options[0]?.[0]} className={inputClass}>
              {options.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            თარიღი
            <input name="count_date" type="date" defaultValue={today} className={inputClass} />
          </label>
        </>
      )}

      <label className="grid gap-1 text-sm">
        საწყობი / ობიექტი
        {sites.length > 0 && (
          <select value={siteId} onChange={(e) => pickSite(e.target.value)} className={inputClass}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {canType && <option value="new">+ სხვა (ხელით)</option>}
          </select>
        )}
      </label>
      {siteId === 'new' ? (
        <input name="branch" required value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="მაგ. ყაზბეგის საწყობი" className={inputClass} />
      ) : (
        <input type="hidden" name="branch" value={branch} />
      )}

      <label className="grid gap-1 text-sm">
        მისამართი
        <input name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ავტომატურად ლოკაციიდან ან ხელით" className={inputClass} />
      </label>

      <input type="hidden" name="lat" value={point?.lat ?? ''} />
      <input type="hidden" name="lng" value={point?.lng ?? ''} />
      <button type="button" onClick={() => locate(true)} className="rounded-control border border-rule-strong px-4 py-2.5 text-sm">
        📍 აქ ვარ — მისამართი ლოკაციიდან
      </button>
      {point && (
        <p className="text-sm text-match">
          ✓ <a href={mapsLink(point.lat, point.lng)} target="_blank" rel="noreferrer" className="underline">რუკაზე</a>
          {point.accuracy != null && <> (±{Math.round(point.accuracy)} მ)</>}
        </p>
      )}
      {locating && <p className="text-sm text-ink-soft">{locating}</p>}

      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending || !(siteId === 'new' ? branch.trim() : branch)}>
        {pending ? 'იხსნება…' : 'გახსნა'}
      </Button>
    </form>
  );
}
