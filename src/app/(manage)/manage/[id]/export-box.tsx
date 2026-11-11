'use client';

import { useState } from 'react';
import { zip } from 'fflate';
import { mediaForExport } from '@/app/(count)/count/actions';

/**
 * Downloads: the counted lines as Excel (every shelf or one), and the shelf
 * photos/videos as one ZIP with a folder per shelf. The ZIP is put together in
 * the browser, so large videos do not have to pass through the server.
 */
export default function ExportBox({
  stocktakeId,
  number,
  shelves,
}: {
  stocktakeId: string;
  number: string;
  shelves: { id: string; code: string }[];
}) {
  const [shelf, setShelf] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const unique = shelves
    .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i)
    .sort((a, b) => a.code.localeCompare(b.code));

  async function downloadMedia() {
    setBusy('ვამზადებ…');
    try {
      const files = await mediaForExport(stocktakeId, shelf);
      if (!files.length) {
        setBusy('ფოტო/ვიდეო არ არის');
        setTimeout(() => setBusy(null), 2000);
        return;
      }
      const parts: Record<string, Uint8Array> = {};
      for (let i = 0; i < files.length; i++) {
        setBusy(`${i + 1} / ${files.length}`);
        const res = await fetch(files[i].url);
        parts[files[i].name] = new Uint8Array(await res.arrayBuffer());
      }
      setBusy('ვკრავ ZIP-ს…');
      // Photos and videos are already compressed: store them as they are.
      const data = await new Promise<Uint8Array>((resolve, reject) =>
        zip(parts, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))),
      );
      const shelfCode =
        shelf === 'all' ? 'ყველა' : (unique.find((s) => s.id === shelf)?.code ?? 'თარო');
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${number}_${shelfCode}_ფოტო.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBusy(null);
    } catch {
      setBusy('ვერ ჩამოიტვირთა, სცადე თავიდან');
      setTimeout(() => setBusy(null), 3000);
    }
  }

  // Outlined green: downloads (the solid green ones open pages).
  const key =
    'rounded-xl border border-[#1f7a4d] bg-white px-4 py-2 text-center text-sm font-semibold text-[#155c39] shadow-sm transition hover:bg-[#eef7f1] active:translate-y-px disabled:opacity-60';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">⬇ ჩამოტვირთვა:</span>
      <select
        value={shelf}
        onChange={(e) => setShelf(e.target.value)}
        className="w-36 rounded-lg border border-rule-strong bg-paper-sunk px-2 py-2 text-sm"
        aria-label="თარო"
      >
        <option value="all">ყველა თარო</option>
        {unique.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code}
          </option>
        ))}
      </select>
      <a href={`/count/${stocktakeId}/export?shelf=${shelf}`} className={key}>
        📊 Excel
      </a>
      <button type="button" onClick={downloadMedia} disabled={!!busy} className={key}>
        {busy ?? '🖼 ფოტო/ვიდეო (ZIP)'}
      </button>
    </div>
  );
}
