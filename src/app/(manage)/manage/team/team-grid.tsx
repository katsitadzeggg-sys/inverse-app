'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/data-grid';
import { cancelInvite, removeMember, restoreMember, setModules, setRole } from './actions';

export type TeamRow = {
  id: string;
  /** member: active; invite: not registered yet; removed: deactivated. */
  state: 'member' | 'invite' | 'removed';
  name: string;
  email: string;
  role: string;
  modules: string[];
  canOpen: boolean;
  canSeeBook: boolean;
  me: boolean;
  /** The viewer may change this person (not themselves, not the owner). */
  editable: boolean;
};

const ROLE: Record<string, string> = {
  owner: 'მფლობელი',
  admin: 'მენეჯერი',
  member: 'აღწერის თანამშრომელი',
  viewer: 'მნახველი',
};
const MOD: [string, string][] = [
  ['stock', '📦 მარაგები'],
  ['expiry', '⏳ ვადიანი'],
  ['assets', '🏷 ძირ. საშ.'],
];
const STATE: Record<TeamRow['state'], [string, string]> = {
  member: ['აქტიური', 'bg-[#e3f4ea] text-[#155c39]'],
  invite: ['მოლოდინში', 'bg-[#fdf3dc] text-[#8a5a00]'],
  removed: ['დეაქტივირებული', 'bg-[#eceff1] text-[#5f6b66]'],
};

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (f: () => Promise<void>) =>
      start(async () => {
        await f();
        router.refresh();
      }),
  };
}

/** Role, changed in place (saved on choosing). */
function RoleCell({ data, context }: ICellRendererParams<TeamRow, unknown, { owner: boolean }>) {
  const { pending, run } = useAct();
  if (!data) return null;
  if (!data.editable || data.state !== 'member') return <span>{ROLE[data.role] ?? data.role}</span>;
  const roles = context?.owner ? ['admin', 'member', 'viewer'] : ['member', 'viewer'];
  return (
    <select
      defaultValue={data.role}
      disabled={pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set('role', e.target.value);
        run(() => setRole(data.id, fd));
      }}
      className="w-full rounded-md border border-rule-strong px-2 py-1 text-xs"
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE[r]}
        </option>
      ))}
    </select>
  );
}

/** A counter's modules and rights: ticked boxes, saved at once. */
function RightsCell({ data }: ICellRendererParams<TeamRow>) {
  const { pending, run } = useAct();
  const [mods, setMods] = useState<string[]>(data?.modules ?? []);
  const [open, setOpen] = useState(!!data?.canOpen);
  const [book, setBook] = useState(!!data?.canSeeBook);
  if (!data || data.state !== 'member' || data.role !== 'member')
    return <span className="text-ink-faint">—</span>;
  const save = (m: string[], o: boolean, b: boolean) => {
    if (!m.length) return;
    const fd = new FormData();
    for (const x of m) fd.append('modules', x);
    if (o) fd.set('can_open', '1');
    if (b) fd.set('can_see_book', '1');
    run(() => setModules(data.id, fd));
  };
  const box = 'flex items-center gap-1 whitespace-nowrap';
  return (
    <span className={`flex items-center gap-3 text-xs ${pending ? 'opacity-60' : ''}`}>
      {MOD.map(([k, v]) => (
        <label key={k} className={box} title={v}>
          <input
            type="checkbox"
            checked={mods.includes(k)}
            disabled={!data.editable || pending}
            onChange={(e) => {
              const m = e.target.checked ? [...mods, k] : mods.filter((x) => x !== k);
              if (!m.length) return;
              setMods(m);
              save(m, open, book);
            }}
          />
          {v.split(' ')[0]}
        </label>
      ))}
      <label className={box} title="ინვენტარიზაციის გახსნის უფლება">
        <input
          type="checkbox"
          checked={open}
          disabled={!data.editable || pending}
          onChange={(e) => {
            setOpen(e.target.checked);
            save(mods, e.target.checked, book);
          }}
        />
        ➕
      </label>
      <label className={box} title="ნაშთის ხედვა — დათვლისას უჩანს, რამდენი უნდა იყოს">
        <input
          type="checkbox"
          checked={book}
          disabled={!data.editable || pending}
          onChange={(e) => {
            setBook(e.target.checked);
            save(mods, open, e.target.checked);
          }}
        />
        👁
      </label>
    </span>
  );
}

function Actions({ data }: ICellRendererParams<TeamRow>) {
  const { pending, run } = useAct();
  if (!data || !data.editable) return null;
  const b = 'rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50';
  if (data.state === 'invite')
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => cancelInvite(data.id))}
        className={`${b} text-[#8a5a00] hover:bg-[#fdf3dc]`}
      >
        გაუქმება
      </button>
    );
  if (data.state === 'removed')
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreMember(data.id))}
        className={`${b} text-[#155c39] hover:bg-[#e3f4ea]`}
      >
        ↺ გააქტიურება
      </button>
    );
  return (
    <button
      type="button"
      disabled={pending}
      title="შესვლას ვეღარ შეძლებს; სახელი ძველ აქტებზე რჩება. დაბრუნება შეიძლება."
      onClick={() => run(() => removeMember(data.id))}
      className={`${b} text-mismatch hover:bg-mismatch/10`}
    >
      დეაქტივაცია
    </button>
  );
}

/** Staff in one table: active people, pending invites and deactivated ones. */
export default function TeamGrid({ rows, owner }: { rows: TeamRow[]; owner: boolean }) {
  const columns = useMemo<ColDef<TeamRow>[]>(
    () => [
      {
        headerName: 'სახელი',
        field: 'name',
        minWidth: 180,
        flex: 1,
        pinned: 'left',
        cellRenderer: (p: ICellRendererParams<TeamRow>) => (
          <span className="font-medium">
            {p.value}
            {p.data?.me && <span className="text-ink-faint"> (შენ)</span>}
          </span>
        ),
      },
      { headerName: 'ელ-ფოსტა', field: 'email', minWidth: 200, flex: 1 },
      {
        headerName: 'როლი',
        field: 'role',
        width: 200,
        cellRenderer: RoleCell,
        filterValueGetter: (p) => ROLE[p.data?.role ?? ''] ?? '',
      },
      {
        headerName: 'მოდულები და უფლებები',
        colId: 'rights',
        width: 300,
        sortable: false,
        filter: false,
        cellRenderer: RightsCell,
      },
      {
        headerName: 'სტატუსი',
        field: 'state',
        width: 170,
        filterValueGetter: (p) => STATE[p.data?.state ?? 'member'][0],
        cellRenderer: (p: ICellRendererParams<TeamRow>) => {
          const [t, c] = STATE[(p.value as TeamRow['state']) ?? 'member'];
          return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{t}</span>;
        },
      },
      {
        headerName: 'მოქმედება',
        colId: 'actions',
        width: 150,
        sortable: false,
        filter: false,
        pinned: 'right',
        cellRenderer: Actions,
      },
    ],
    [],
  );
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowId={(r) => `${r.state}-${r.id}`}
      fileName="gundi"
      height={Math.min(640, 150 + rows.length * 40)}
      context={{ owner }}
    />
  );
}
