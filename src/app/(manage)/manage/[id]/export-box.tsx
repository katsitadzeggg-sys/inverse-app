'use client';

import { useState } from 'react';
import { zip } from 'fflate';
import { mediaForExport } from '@/app/(count)/count/actions';

/**
 * Downloads: the counted lines as Excel (every shelf or one), and the shelf
 * photos/videos as one ZIP with a folder per shelf. The ZIP is put together in
 * the browser, so large videos do not have to pass through the server.
 */
export default function ExportBox({ stocktakeId, number, shelves }: { stocktakeId: string; number: string; shelves: { id: string; code: string }[] }) {
  const [shelf, setShelf] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const unique = shelves.filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i).sort((a, b) => a.code.localeCompare(b.code));

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
      const shelfCode = shelf === 'all' ? 'ყველა' : (unique.find((s) => s.id === shelf)?.code ?? 'თარო');
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

  return (
    <div className="grid gap-2">
      <select
        value={shelf}
        onChange={(e) => setShelf(e.target.value)}
        className="rounded-control border border-rule-strong bg-paper-sunk px-3 py-3 text-sm"
        aria-label="თარო"
      >
        <option value="all">ყველა თარო</option>
        {unique.map((s) => (
          <option key={s.id} value={s.id}>{s.code}</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <a href={`/count/${stocktakeId}/export?shelf=${shelf}`} className="rounded-control border border-rule-strong px-3 py-3 text-center text-sm font-semibold">
          ⬇ Excel
        </a>
        <button type="button" onClick={downloadMedia} disabled={!!busy} className="rounded-control border border-rule-strong px-3 py-3 text-sm font-semibold">
          {busy ?? '⬇ ფოტო/ვიდეო (ZIP)'}
        </button>
      </div>
    </div>
  );
}
