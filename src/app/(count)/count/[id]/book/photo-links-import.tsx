'use client';

import { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert } from '@/components/ui';
import { setProductPhotos, type PhotoRow } from './photo-actions';

const CODE = /(შტრიხ|ბარკოდ|barcode|ean|gtin|sku|mpn|არტიკ|კოდ|code|штрих|артикул)/i;
const LINK = /(ლინკ|ბმულ|link|url|image|photo|ფოტო|სურათ)/i;
const cell = (c: unknown) => (c == null ? '' : String(c).trim().replace(/\.0+$/, ''));

/**
 * Product photos from a file with links (e.g. a shop export: barcode, SKU,
 * article, photo link). Each product of this company found by any of the
 * codes gets the link as its photo — for the counter's "🖼 photo" and the AI
 * shelf check. Products that already have a photo keep it.
 */
export default function PhotoLinksImport() {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ file: number; added: number; had: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setError(null);
    setDone(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError(
        'ეს ძველი .xls ფორმატია — Excel-ში გახსენი და შეინახე როგორც .xlsx (File → Save As → Excel Workbook), მერე ატვირთე.',
      );
      return;
    }
    setBusy('ფაილს ვკითხულობ…');
    try {
      const sheet = (await readXlsxFile(file)).map((r) => r.map(cell));
      const head = sheet[0] ?? [];
      const body = sheet.slice(1);
      const isLink = (i: number) =>
        body.slice(0, 50).filter((r) => /^https?:\/\//i.test(r[i] ?? '')).length >= 5;
      const linkCol = head.findIndex((h, i) => LINK.test(h) && isLink(i));
      const codeCols = head.map((h, i) => (CODE.test(h) ? i : -1)).filter((i) => i >= 0);
      if (linkCol < 0 || !codeCols.length) {
        setBusy(null);
        setError('ფაილში ვერ ვიპოვე ფოტოს ლინკის ან შტრიხკოდის/კოდის სვეტი.');
        return;
      }
      const rows: PhotoRow[] = body
        .map((r) => ({ url: r[linkCol] ?? '', codes: codeCols.map((i) => r[i] ?? '') }))
        .filter((r) => /^https?:\/\//i.test(r.url));
      let matched = 0;
      let updated = 0;
      const STEP = 800;
      for (let i = 0; i < rows.length; i += STEP) {
        setBusy(`ვამოწმებ… ${Math.min(i + STEP, rows.length)} / ${rows.length}`);
        const r = await setProductPhotos(rows.slice(i, i + STEP));
        if (r.error) throw new Error(r.error);
        matched += r.matched ?? 0;
        updated += r.updated ?? 0;
      }
      setDone({ file: rows.length, added: updated, had: matched - updated });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ვერ ჩაიტვირთა.');
    }
    setBusy(null);
  }

  return (
    <div className="grid gap-2 text-sm">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-rule-strong bg-paper px-4 py-3 text-base font-semibold hover:border-[#2fbf71]">
        🖼 ფოტოების ატვირთვა (ბმულები, Excel)
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          disabled={!!busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(f);
          }}
        />
      </label>
      {busy && <p className="text-ink-soft">{busy}</p>}
      {done && (
        <div className="grid gap-2 rounded-xl border border-[#2fbf71]/40 bg-[#2fbf71]/10 p-4">
          <p className="text-base font-semibold text-[#2fbf71]">✓ ფოტოები ჩაიტვირთა</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['დაემატა', done.added],
                ['უკვე ჰქონდა', done.had],
                ['ფაილში', done.file],
              ] as [string, number][]
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-paper px-2 py-2">
                <p className="text-lg font-semibold tabular-nums">{v.toLocaleString('ka-GE')}</p>
                <p className="text-xs text-ink-faint">{k}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
