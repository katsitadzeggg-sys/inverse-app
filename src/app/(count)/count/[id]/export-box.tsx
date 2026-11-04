'use client';

import { useState } from 'react';

/** Download the counted lines as Excel: every shelf together, or one shelf. */
export default function ExportBox({ stocktakeId, shelves }: { stocktakeId: string; shelves: { id: string; code: string }[] }) {
  const [shelf, setShelf] = useState('all');
  const unique = shelves.filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="flex gap-2">
      <select
        value={shelf}
        onChange={(e) => setShelf(e.target.value)}
        className="min-w-0 flex-1 rounded-control border border-rule-strong bg-paper-sunk px-3 py-3 text-sm"
        aria-label="თარო"
      >
        <option value="all">ყველა თარო</option>
        {unique.map((s) => (
          <option key={s.id} value={s.id}>{s.code}</option>
        ))}
      </select>
      <a
        href={`/count/${stocktakeId}/export?shelf=${shelf}`}
        className="shrink-0 rounded-control border border-rule-strong px-4 py-3 text-sm font-semibold"
      >
        ⬇ ჩამოტვირთვა
      </a>
    </div>
  );
}
