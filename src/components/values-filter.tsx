'use client';

import { useCallback, useMemo, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';
import type { IDoesFilterPassParams, IRowNode } from 'ag-grid-community';

const text = (v: unknown) => (v == null || v === '' ? '(ცარიელი)' : String(v));

/**
 * A text column's filter: the values the column actually holds, each with a
 * tick box, and a search over them. The model is the ticked values (null =
 * no filter).
 */
export default function ValuesFilter({ model, onModelChange, api, getValue }: CustomFilterProps) {
  const [q, setQ] = useState('');
  const valueOf = useCallback((node: IRowNode) => text(getValue(node)), [getValue]);

  // Every value in the column, counted; recomputed when the menu opens.
  const values = useMemo(() => {
    const m = new Map<string, number>();
    api.forEachNode((node) => {
      if (!node.data) return;
      const v = valueOf(node);
      m.set(v, (m.get(v) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ka'));
  }, [api, valueOf]);

  const chosen = useMemo(() => new Set<string>(model ?? []), [model]);
  const doesFilterPass = useCallback(
    ({ node }: IDoesFilterPassParams) => chosen.has(valueOf(node)),
    [chosen, valueOf],
  );
  useGridFilter({ doesFilterPass });

  const shown = values.filter(([v]) => v.toLowerCase().includes(q.trim().toLowerCase()));
  const set = (next: Set<string>) =>
    onModelChange(next.size === 0 || next.size === values.length ? null : [...next]);
  const all = model == null;

  return (
    <div className="grid w-64 gap-2 p-3 text-sm">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ძებნა…"
        className="rounded-md border border-rule-strong bg-transparent px-2 py-1"
      />
      <label className="flex items-center gap-2 border-b border-rule pb-1.5 font-medium">
        <input type="checkbox" checked={all} onChange={() => onModelChange(null)} />
        ყველა
      </label>
      <div className="grid max-h-56 gap-1 overflow-y-auto">
        {shown.map(([v, n]) => (
          <label key={v} className="flex items-center gap-2" title={v}>
            <input
              type="checkbox"
              checked={all || chosen.has(v)}
              onChange={(e) => {
                const next = new Set(all ? values.map(([x]) => x) : chosen);
                if (e.target.checked) next.add(v);
                else next.delete(v);
                set(next);
              }}
            />
            <span className="min-w-0 flex-1 truncate">{v}</span>
            <span className="text-xs text-ink-faint tabular-nums">{n}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="text-xs text-ink-faint">ვერ მოიძებნა.</p>}
      </div>
    </div>
  );
}
