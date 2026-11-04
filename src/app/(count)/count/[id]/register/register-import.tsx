'use client';

import { useState, useTransition } from 'react';
import readXlsxFile from 'read-excel-file';
import { Alert } from '@/components/ui';
import { importRegister, type RegisterRow } from '../../assets-actions';

type Field = 'invNo' | 'name' | 'room' | 'responsible' | 'value' | 'serial';

// Header words seen in fixed-asset registers from Balance, FINA, 1C, Oris and hand-made sheets.
const GUESS: Record<Field, RegExp> = {
  invNo: /(საინვ|ინვენტ|ინვ\.?\s*№|ინვ\.|inv|инвент|tag|asset\s*(no|id))/i,
  name: /(დასახ|სახელ|name|наимен|название|აღწერ)/i,
  room: /(ოთახ|ადგილ|მდებარ|ლოკაც|სართ|room|location|place|помещ|кабинет|место)/i,
  responsible: /(პასუხ|მატ\.?\s*პას|მფლობ|responsible|owner|custod|ответств|мол)/i,
  value: /(ღირებ|ფასი|ნარჩ|საბალანსო|value|cost|cтоим|стоим)/i,
  serial: /(სერ|serial|s\/n|зав|серийн)/i,
};

const LABELS: Record<Field, string> = {
  invNo: 'საინვენტარო № *',
  name: 'დასახელება *',
  room: 'ოთახი / ადგილი',
  responsible: 'პასუხისმგებელი',
  value: 'ღირებულება',
  serial: 'სერიული №',
};

function parseCsv(text: string): string[][] {
  const first = text.split('\n')[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}

const num = (v: string) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));

/** Excel or CSV → register lines; the columns are guessed and can be changed. */
export default function RegisterImport({ stocktakeId }: { stocktakeId: string }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<Record<Field, number>>({ invNo: -1, name: -1, room: -1, responsible: -1, value: -1, serial: -1 });
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    setMsg(null);
    const rows = /\.(xlsx|xlsm)$/i.test(file.name)
      ? (await readXlsxFile(file)).map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))
      : parseCsv(await file.text());
    const h = Math.max(0, rows.slice(0, 10).findIndex((r) => r.some((c) => GUESS.invNo.test(c)) && r.some((c) => GUESS.name.test(c))));
    const header = rows[h] ?? [];
    const guess = Object.fromEntries(
      (Object.keys(GUESS) as Field[]).map((f) => [f, header.findIndex((c) => GUESS[f].test(c) && !(f !== 'invNo' && GUESS.invNo.test(c)))]),
    ) as Record<Field, number>;
    setTable(rows);
    setHeaderRow(h);
    setMap(guess);
  }

  const header = table?.[headerRow] ?? [];
  const body = table ? table.slice(headerRow + 1).filter((r) => r.some((c) => c !== '')) : [];
  const cell = (r: string[], f: Field) => (map[f] >= 0 ? (r[map[f]] ?? '').trim() : '');
  const preview: RegisterRow[] = body.map((r) => ({
    invNo: cell(r, 'invNo'),
    name: cell(r, 'name'),
    room: cell(r, 'room'),
    responsible: cell(r, 'responsible'),
    value: cell(r, 'value') ? num(cell(r, 'value')) : null,
    serial: cell(r, 'serial'),
  }));
  const valid = preview.filter((r) => r.invNo);

  return (
    <div className="grid gap-4">
      <label className="grid cursor-pointer gap-2 rounded-control border-2 border-dashed border-rule-strong p-6 text-center">
        <span className="text-base font-semibold">📄 აირჩიე რეესტრის Excel ან CSV</span>
        <span className="text-sm text-ink-faint">საჭიროა: საინვენტარო ნომერი და დასახელება. სასურველია: ოთახი, პასუხისმგებელი, ღირებულება, სერიული ნომერი.</span>
        <input type="file" accept=".xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </label>

      {table && (
        <>
          <div className="grid gap-2 rounded-control border border-rule/70 p-4">
            <p className="text-sm font-semibold">სვეტები</p>
            {(Object.keys(LABELS) as Field[]).map((f) => (
              <label key={f} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
                <span>{LABELS[f]}</span>
                <select
                  value={map[f]}
                  onChange={(e) => setMap({ ...map, [f]: Number(e.target.value) })}
                  className="rounded-control border border-rule-strong bg-paper-sunk px-2 py-1.5"
                >
                  <option value={-1}>—</option>
                  {header.map((c, i) => (
                    <option key={i} value={i}>{c || `სვეტი ${i + 1}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="overflow-x-auto rounded-control border border-rule/70">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left">
                <tr><th className="p-2">ინვ. №</th><th className="p-2">დასახელება</th><th className="p-2">ოთახი</th><th className="p-2">პასუხისმგ.</th><th className="p-2 text-right">ღირებ.</th></tr>
              </thead>
              <tbody>
                {preview.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-rule/60">
                    <td className={`p-2 ${r.invNo ? '' : 'text-mismatch'}`}>{r.invNo || '?'}</td>
                    <td className="p-2">{r.name}</td><td className="p-2">{r.room}</td><td className="p-2">{r.responsible}</td>
                    <td className="p-2 text-right">{r.value ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-2 text-xs text-ink-faint">სულ {body.length} ხაზი, აქედან სწორი {valid.length}.</p>
          </div>

          <button
            type="button"
            disabled={pending || !valid.length}
            onClick={() =>
              start(async () => {
                const res = await importRegister(stocktakeId, valid);
                setMsg(res.error ? { tone: 'error', text: res.error } : { tone: 'info', text: res.notice ?? 'ჩაიტვირთა' });
              })
            }
            className="rounded-control bg-ink px-4 py-4 text-base font-semibold text-paper disabled:opacity-50"
          >
            {pending ? 'იტვირთება…' : `რეესტრის ჩატვირთვა (${valid.length})`}
          </button>
        </>
      )}

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
