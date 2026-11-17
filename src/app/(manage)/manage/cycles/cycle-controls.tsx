'use client';

import { useState, useTransition } from 'react';
import { createCycle, updateCycle } from './actions';

/** The cycle's name; the manager can rename it in place. */
export function CycleNameEdit({
  cycleId,
  name,
  code,
  editable,
}: {
  cycleId: string;
  name: string;
  code: string;
  editable: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (edit)
    return (
      <form
        action={(fd) =>
          start(async () => {
            const r = await updateCycle(cycleId, { name: String(fd.get('name') ?? '') });
            if (r.error) setErr(r.error);
            else setEdit(false);
          })
        }
        className="flex flex-wrap items-center gap-1"
      >
        <input
          name="name"
          defaultValue={name}
          autoFocus
          className="w-48 rounded-md border border-rule-strong bg-paper px-2 py-0.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#1f7a4d] px-2 py-0.5 text-xs font-semibold text-white"
        >
          {pending ? '…' : 'შენახვა'}
        </button>
        <button type="button" onClick={() => setEdit(false)} className="text-xs underline">
          გაუქმება
        </button>
        {err && <span className="text-xs text-mismatch">{err}</span>}
      </form>
    );
  return (
    <span>
      {name}
      {code && <span className="ml-1.5 text-xs font-normal text-ink-faint">{code}</span>}
      {editable && (
        <button
          type="button"
          onClick={() => setEdit(true)}
          title="სახელის შეცვლა"
          className="ml-1.5 text-xs font-normal text-ink-faint hover:text-ink"
        >
          ✎
        </button>
      )}
    </span>
  );
}

/** A closed cycle to the archive, or back. */
export function ArchiveCycle({ cycleId, archived }: { cycleId: string; archived: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="grid gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await updateCycle(cycleId, { archived: !archived });
            setErr(r.error ?? null);
          })
        }
        className="rounded-full border border-rule-strong px-3 py-1 text-xs font-medium hover:bg-ink/5"
      >
        {pending ? '…' : archived ? '↩ არქივიდან' : '🗄 არქივში'}
      </button>
      {err && <span className="text-xs text-mismatch">{err}</span>}
    </span>
  );
}

/** "+ new cycle": a warehouse with no open cycle, and its name. */
export function NewCycleForm({
  warehouses,
  suggested,
}: {
  warehouses: string[];
  suggested: string;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[#1f7a4d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#155c39]"
      >
        + ახალი ციკლი
      </button>
    );
  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await createCycle(fd);
          if (r.error) setErr(r.error);
          else {
            setErr(null);
            setOpen(false);
          }
        })
      }
      className="grid gap-2 rounded-xl border border-rule p-3 text-sm sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
    >
      <label className="grid gap-1">
        საწყობი
        <select
          name="warehouse"
          required
          className="rounded-md border border-rule-strong bg-paper px-2 py-1.5"
        >
          {warehouses.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        ციკლის სახელი
        <input
          name="name"
          required
          defaultValue={suggested}
          placeholder="მაგ. 2026 წლის ბოლო აღწერა"
          className="rounded-md border border-rule-strong bg-paper px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={pending || warehouses.length === 0}
        className="rounded-full bg-[#1f7a4d] px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {pending ? '…' : 'შექმნა'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="underline">
        გაუქმება
      </button>
      {warehouses.length === 0 && (
        <p className="text-xs text-ink-faint sm:col-span-4">
          ყველა საწყობს უკვე აქვს ღია ციკლი — ახლისთვის ჯერ ის დახურე.
        </p>
      )}
      {err && <p className="text-xs text-mismatch sm:col-span-4">{err}</p>}
    </form>
  );
}
