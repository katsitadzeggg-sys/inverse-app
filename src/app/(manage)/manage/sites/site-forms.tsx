'use client';

import { useActionState, useState, useTransition } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert, Button, inputClass } from '@/components/ui';
import MapPicker from '@/components/map-picker';
import { addSite, importSites } from './actions';
import type { FormState } from '@/app/(count)/count/actions';

const EMPTY: FormState = {};

/** Add one site (with "I'm here" for the map point and address), or load a list from Excel. */
export default function SiteForms() {
  const [state, action, pending] = useActionState(addSite, EMPTY);
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [msg, setMsg] = useState<FormState>({});
  const [busy, start] = useTransition();

  return (
    <div className="grid content-start gap-4">
      <form action={action} className="grid gap-3 rounded-control border border-rule/70 p-4">
        <p className="font-semibold">➕ საწყობი / ობიექტი</p>
        <input
          name="name"
          required
          placeholder="სახელი, მაგ. ყაზბეგის საწყობი"
          className={inputClass}
        />
        <input
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="მისამართი"
          className={inputClass}
        />
        <input type="hidden" name="lat" value={point?.lat ?? ''} />
        <input type="hidden" name="lng" value={point?.lng ?? ''} />
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="rounded-control border border-rule-strong px-3 py-2 text-sm"
        >
          📍 ლოკაცია რუკაზე — მისამართი ავტომატურად
        </button>
        {mapOpen && (
          <MapPicker
            start={point}
            onClose={() => setMapOpen(false)}
            onPick={(p, a) => {
              setPoint(p);
              if (a) setAddress(a);
              setLocating(a ? null : 'წერტილი ჩაიწერა, მისამართი ჩაწერე ხელით.');
              setMapOpen(false);
            }}
          />
        )}
        {point && <p className="text-xs text-match">✓ წერტილი ჩაიწერა</p>}
        {locating && <p className="text-xs text-ink-soft">{locating}</p>}
        {state.error && <Alert>{state.error}</Alert>}
        {state.notice && <Alert tone="info">{state.notice}</Alert>}
        <Button type="submit" disabled={pending}>
          {pending ? '…' : 'დამატება'}
        </Button>
      </form>

      {/* Many at once: download the template, fill it in, load it back. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">📄 სია Excel-ით:</span>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
        <a
          href="/manage/sites/template"
          className="rounded-control border border-rule-strong px-3 py-1.5 font-medium"
        >
          ⬇ შაბლონი
        </a>
        <label
          title="შაბლონი: A — სახელი, B — მისამართი"
          className="rounded-control border border-dashed border-rule-strong px-3 py-1.5 font-medium"
        >
          ⬆ ატვირთვა
          <input
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              let rows: string[][];
              try {
                rows = (await readXlsxFile(f)).map((r) =>
                  r.map((c) => (c == null ? '' : String(c))),
                );
              } catch {
                setMsg({
                  error: 'ფაილი ვერ წავიკითხე. გახსენი Excel-ში, შეინახე და თავიდან აირჩიე.',
                });
                return;
              }
              const body = /სახელ|name|საწყობ|ობიექტ/i.test(rows[0]?.[0] ?? '')
                ? rows.slice(1)
                : rows;
              start(async () =>
                setMsg(
                  await importSites(body.map((r) => ({ name: r[0] ?? '', address: r[1] ?? '' }))),
                ),
              );
            }}
          />
        </label>
      </div>
      {busy && <p className="text-sm text-ink-soft">იტვირთება…</p>}
      {msg.error && <Alert>{msg.error}</Alert>}
      {msg.notice && <Alert tone="info">{msg.notice}</Alert>}
    </div>
  );
}
