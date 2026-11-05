import type { SupabaseClient } from '@supabase/supabase-js';
import { normKey } from '@/lib/text';

export type AssetStatus = 'found' | 'moved' | 'missing' | 'surplus';

export type AssetRow = {
  checkId: string | null;
  invNo: string;
  name: string;
  registerRoom: string | null;
  actualRoom: string | null;
  responsible: string | null;
  value: number | null;
  serial: string | null;
  status: AssetStatus;
  condition: 'good' | 'damaged' | 'writeoff' | null;
  needsLabel: boolean;
  note: string | null;
  counter: string | null;
  photos: number;
  videos: number;
  group: string | null;
};

export const ASSET_STATUS: Record<AssetStatus, string> = {
  found: 'ნაპოვნი',
  moved: 'გადაადგილებული',
  missing: 'დაკარგული',
  surplus: 'მეტობა',
};

export const CONDITION: Record<string, string> = { good: 'კარგი', damaged: 'დაზიანებული', writeoff: 'ჩამოსაწერი' };

// "A-302", "a 302" and "A302" are the same room.
const norm = (s: string | null) => normKey(s);
const same = (a: string | null, b: string | null) => norm(a) === norm(b);

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await make(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** The register against what was found: found, moved, missing and surplus, with condition. */
export async function loadAssetResult(supabase: SupabaseClient, stocktakeId: string): Promise<AssetRow[]> {
  type Reg = { id: string; inv_no: string; name: string; room: string | null; responsible: string | null; value: number | null; serial: string | null; group_name: string | null };
  type Chk = {
    id: string; register_id: string | null; inv_no: string; name: string; condition: 'good' | 'damaged' | 'writeoff';
    responsible: string | null; serial: string | null; needs_label: boolean; note: string | null; counter_id: string | null; group_name: string | null;
    locations: { code: string } | null;
  };
  const [reg, checks, media, people] = await Promise.all([
    all<Reg>((a, b) => supabase.from('asset_register').select('id, inv_no, name, room, responsible, value, serial, group_name').eq('stocktake_id', stocktakeId).order('inv_no').range(a, b)),
    all<Chk>((a, b) =>
      supabase
        .from('asset_checks')
        .select('id, register_id, inv_no, name, condition, responsible, serial, needs_label, note, counter_id, group_name, locations (code)')
        .eq('stocktake_id', stocktakeId)
        .range(a, b)
        .returns<Chk[]>(),
    ),
    all<{ asset_check_id: string; kind: string }>((a, b) =>
      supabase.from('stocktake_media').select('asset_check_id, kind').eq('stocktake_id', stocktakeId).not('asset_check_id', 'is', null).range(a, b),
    ),
    supabase.from('user_profiles').select('id, full_name, email').then((r) => r.data ?? []),
  ]);
  const who = new Map(people.map((p: { id: string; full_name: string | null; email: string }) => [p.id, p.full_name ?? p.email]));
  const shots = new Map<string, { photos: number; videos: number }>();
  for (const m of media) {
    const s = shots.get(m.asset_check_id) ?? { photos: 0, videos: 0 };
    if (m.kind === 'video') s.videos += 1;
    else s.photos += 1;
    shots.set(m.asset_check_id, s);
  }
  const byReg = new Map(checks.filter((c) => c.register_id).map((c) => [c.register_id!, c]));
  const row = (c: Chk | undefined, r: Reg | undefined): AssetRow => {
    const actual = c?.locations?.code ?? null;
    const status: AssetStatus = !r ? 'surplus' : !c ? 'missing' : r.room && !same(r.room, actual) ? 'moved' : 'found';
    return {
      checkId: c?.id ?? null,
      invNo: r?.inv_no ?? c!.inv_no,
      name: r?.name ?? c!.name,
      registerRoom: r?.room ?? null,
      actualRoom: actual,
      responsible: c?.responsible ?? r?.responsible ?? null,
      value: r?.value != null ? Number(r.value) : null,
      serial: c?.serial ?? r?.serial ?? null,
      status,
      condition: c?.condition ?? null,
      needsLabel: c?.needs_label ?? false,
      note: c?.note ?? null,
      counter: c?.counter_id ? (who.get(c.counter_id) ?? null) : null,
      photos: c ? (shots.get(c.id)?.photos ?? 0) : 0,
      videos: c ? (shots.get(c.id)?.videos ?? 0) : 0,
      group: c?.group_name?.trim() || r?.group_name?.trim() || null,
    };
  };
  return [...reg.map((r) => row(byReg.get(r.id), r)), ...checks.filter((c) => !c.register_id).map((c) => row(c, undefined))];
}
