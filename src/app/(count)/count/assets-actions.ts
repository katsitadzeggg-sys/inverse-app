'use server';

import { revalidatePath } from 'next/cache';
import { mkhedruli, normKey, upperLatin } from '@/lib/text';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { FormState } from './actions';

export type RegisterRow = {
  invNo: string;
  name: string;
  room: string;
  responsible: string;
  value: number | null;
  serial: string;
  group?: string;
};

export type AssetHit = {
  registerId: string | null;
  invNo: string;
  name: string;
  room: string | null;
  responsible: string | null;
  serial: string | null;
  /** Already recorded in this stocktake (by anyone). */
  checkedId: string | null;
  checkedRoom: string | null;
  /** Details taken from an earlier stocktake of the company. */
  fromHistory?: boolean;
  group?: string | null;
};

const isManager = (role: string) => role === 'owner' || role === 'admin';

/** Same inventory number however it was typed: spaces and case do not matter. */
const normInv = (s: string) => upperLatin(mkhedruli(s.trim().replace(/\s+/g, '')));

/** The manager loads the asset register; a new file replaces the old one. */
export async function importRegister(stocktakeId: string, rows: RegisterRow[]): Promise<FormState> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'რეესტრს მხოლოდ მენეჯერი ტვირთავს.' };
  const seen = new Set<string>();
  const lines = [];
  for (const r of rows) {
    const inv = normInv(r.invNo);
    if (!inv || seen.has(inv)) continue;
    seen.add(inv);
    lines.push({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      inv_no: inv,
      name: r.name.trim() || inv,
      room: r.room.trim() || null,
      responsible: r.responsible.trim() || null,
      value: r.value != null && Number.isFinite(r.value) ? r.value : null,
      serial: r.serial.trim() || null,
      group_name: r.group?.trim() || null,
    });
  }
  if (!lines.length) return { error: 'ფაილში ხაზი ვერ ვიპოვე: საჭიროა საინვენტარო ნომერი.' };
  if (lines.length > 20000) return { error: 'ერთ ჯერზე მაქსიმუმ 20 000 ხაზი.' };

  const supabase = await createClient();
  const { error: delError } = await supabase
    .from('asset_register')
    .delete()
    .eq('stocktake_id', stocktakeId);
  if (delError) return { error: delError.message };
  for (let i = 0; i < lines.length; i += 1000) {
    const { error } = await supabase.from('asset_register').insert(lines.slice(i, i + 1000));
    if (error) return { error: error.message };
  }
  // Re-link records made before this import.
  const { data: checks } = await supabase
    .from('asset_checks')
    .select('id, inv_no')
    .eq('stocktake_id', stocktakeId);
  if (checks?.length) {
    const { data: reg } = await supabase
      .from('asset_register')
      .select('id, inv_no')
      .eq('stocktake_id', stocktakeId)
      .in(
        'inv_no',
        checks.map((c) => c.inv_no),
      );
    const byInv = new Map((reg ?? []).map((r) => [r.inv_no, r.id]));
    for (const c of checks)
      await supabase
        .from('asset_checks')
        .update({ register_id: byInv.get(c.inv_no) ?? null })
        .eq('id', c.id);
  }
  revalidatePath(`/manage/${stocktakeId}`);
  return { notice: `ჩაიტვირთა ${lines.length} ძირითადი საშუალება.` };
}

/** Finds an asset by its label (inventory number), serial number, or name. */
export async function findAsset(stocktakeId: string, text: string): Promise<AssetHit[]> {
  await requireSession();
  const q = text.trim();
  if (!q) return [];
  const supabase = await createClient();
  const inv = normInv(q);
  const safe = q.replace(/[,()%"\\]/g, ' ').trim();
  const { data: reg } = await supabase
    .from('asset_register')
    .select('id, inv_no, name, room, responsible, serial, group_name')
    .eq('stocktake_id', stocktakeId)
    .or(`inv_no.eq."${inv.replace(/[,()"\\]/g, '')}",serial.eq."${safe}",name.ilike."%${safe}%"`)
    .limit(10);
  const invs = [...new Set([inv, ...(reg ?? []).map((r) => r.inv_no)])];
  const { data: checks } = await supabase
    .from('asset_checks')
    .select('id, inv_no, name, locations (code)')
    .eq('stocktake_id', stocktakeId)
    .in('inv_no', invs)
    .returns<{ id: string; inv_no: string; name: string; locations: { code: string } | null }[]>();
  const done = new Map((checks ?? []).map((c) => [c.inv_no, c]));
  const hits: AssetHit[] = (reg ?? [])
    .sort((a, b) => Number(b.inv_no === inv) - Number(a.inv_no === inv))
    .map((r) => ({
      registerId: r.id,
      invNo: r.inv_no,
      name: r.name,
      room: r.room,
      responsible: r.responsible,
      serial: r.serial,
      group: r.group_name,
      checkedId: done.get(r.inv_no)?.id ?? null,
      checkedRoom: done.get(r.inv_no)?.locations?.code ?? null,
    }));
  // A surplus item recorded earlier is found by its number too.
  const surplus = done.get(inv);
  if (surplus && !hits.some((h) => h.invNo === inv)) {
    hits.unshift({
      registerId: null,
      invNo: inv,
      name: surplus.name,
      room: null,
      responsible: null,
      serial: null,
      checkedId: surplus.id,
      checkedRoom: surplus.locations?.code ?? null,
    });
  }
  // Not in this stocktake's register: take the details from the company's
  // earlier registers or counts, so the counter does not type them again.
  if (!hits.length) {
    const [{ data: oldReg }, { data: oldChk }] = await Promise.all([
      supabase
        .from('asset_register')
        .select('inv_no, name, room, responsible, serial, group_name')
        .eq('inv_no', inv)
        .neq('stocktake_id', stocktakeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .returns<
          {
            inv_no: string;
            name: string;
            room: string | null;
            responsible: string | null;
            serial: string | null;
            group_name: string | null;
          }[]
        >(),
      supabase
        .from('asset_checks')
        .select('inv_no, name, responsible, serial, group_name, locations (code)')
        .eq('inv_no', inv)
        .neq('stocktake_id', stocktakeId)
        .order('checked_at', { ascending: false })
        .limit(1)
        .returns<
          {
            inv_no: string;
            name: string;
            responsible: string | null;
            serial: string | null;
            group_name: string | null;
            locations: { code: string } | null;
          }[]
        >(),
    ]);
    const r = oldReg?.[0];
    const c = oldChk?.[0];
    if (r || c) {
      hits.push({
        registerId: null,
        invNo: inv,
        name: c?.name ?? r!.name,
        room: c?.locations?.code ?? r?.room ?? null,
        responsible: c?.responsible ?? r?.responsible ?? null,
        serial: c?.serial ?? r?.serial ?? null,
        group: c?.group_name ?? r?.group_name ?? null,
        checkedId: null,
        checkedRoom: null,
        fromHistory: true,
      });
    }
  }
  return hits;
}

const DEFAULT_GROUPS = [
  'ავეჯი',
  'კომპიუტერული ტექნიკა',
  'საოფისე ტექნიკა',
  'საყოფაცხოვრებო ტექნიკა',
  'ქსელი და კავშირი',
  'ინვენტარი',
  'სატრანსპორტო საშუალება',
  'სხვა',
];

/** Asset groups known to the company, plus the usual ones. */
export async function assetGroups(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.from('asset_register').select('group_name').not('group_name', 'is', null).limit(5000),
    supabase.from('asset_checks').select('group_name').not('group_name', 'is', null).limit(5000),
  ]);
  const set = new Set<string>(DEFAULT_GROUPS);
  for (const r of [...(a ?? []), ...(b ?? [])])
    if (r.group_name?.trim()) set.add(r.group_name.trim());
  return [...set];
}

/** Names of responsible people: from registers and earlier counts of the company. */
export async function responsibleNames(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase
      .from('asset_register')
      .select('responsible')
      .not('responsible', 'is', null)
      .limit(5000),
    supabase.from('asset_checks').select('responsible').not('responsible', 'is', null).limit(5000),
  ]);
  const names = new Set<string>();
  for (const r of [...(a ?? []), ...(b ?? [])])
    if (r.responsible?.trim()) names.add(r.responsible.trim());
  return [...names].sort((x, y) => x.localeCompare(y));
}

export type AssetInput = {
  registerId: string | null;
  invNo: string;
  name: string;
  condition: 'good' | 'damaged' | 'writeoff';
  responsible: string;
  serial: string;
  needsLabel: boolean;
  note: string;
  group?: string;
  lat: number | null;
  lng: number | null;
};

/** Records (or updates) one asset found in the room. Returns its record id. */
export async function saveAssetCheck(
  stocktakeId: string,
  locationId: string,
  input: AssetInput,
): Promise<FormState & { id?: string }> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს ჩაწერა არ შეუძლია.' };
  const inv = normInv(input.invNo);
  if (!inv) return { error: 'ჩაწერე საინვენტარო ნომერი.' };
  if (!input.name.trim()) return { error: 'ჩაწერე დასახელება.' };
  const supabase = await createClient();
  const row = {
    company_id: session.company.id,
    stocktake_id: stocktakeId,
    register_id: input.registerId,
    location_id: locationId,
    inv_no: inv,
    name: input.name.trim().slice(0, 300),
    condition: input.condition,
    responsible: input.responsible.trim() || null,
    serial: input.serial.trim().replace(/[^\p{L}\p{N}]+$/u, '') || null, // drop stray ?/ . at the end
    needs_label: input.needsLabel,
    group_name: input.group?.trim().slice(0, 100) || null,
    note: input.note.trim().slice(0, 1000) || null,
    lat: input.lat,
    lng: input.lng,
    checked_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from('asset_checks')
    .select('id')
    .eq('stocktake_id', stocktakeId)
    .eq('inv_no', inv)
    .maybeSingle<{ id: string }>();
  const res = existing
    ? await supabase
        .from('asset_checks')
        .update(row)
        .eq('id', existing.id)
        .select('id')
        .single<{ id: string }>()
    : await supabase
        .from('asset_checks')
        .insert({ ...row, counter_id: session.userId })
        .select('id')
        .single<{ id: string }>();
  if (res.error) {
    return {
      error: res.error.message.includes('closed')
        ? 'ინვენტარიზაცია დახურულია.'
        : res.error.message.includes('row-level')
          ? 'ეს ჩანაწერი სხვა აღწერის თანამშრომელს ეკუთვნის.'
          : res.error.message,
    };
  }
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  return { id: res.data.id, notice: existing ? 'განახლდა' : 'ჩაიწერა' };
}

export async function deleteAssetCheck(
  stocktakeId: string,
  locationId: string,
  id: string,
): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.from('asset_checks').delete().eq('id', id);
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
}

/** The whole register to pick from (🔍 with nothing typed): this room's items first, not yet recorded before recorded. */
export async function browseRegister(stocktakeId: string, room: string): Promise<AssetHit[]> {
  await requireSession();
  const supabase = await createClient();
  const [{ data: reg }, { data: checks }] = await Promise.all([
    supabase
      .from('asset_register')
      .select('id, inv_no, name, room, responsible, serial, group_name')
      .eq('stocktake_id', stocktakeId)
      .order('inv_no')
      .limit(2000),
    supabase
      .from('asset_checks')
      .select('id, inv_no, locations (code)')
      .eq('stocktake_id', stocktakeId)
      .limit(5000)
      .returns<{ id: string; inv_no: string; locations: { code: string } | null }[]>(),
  ]);
  const done = new Map((checks ?? []).map((c) => [c.inv_no, c]));
  const here = normKey(room);
  return (reg ?? [])
    .map((r) => ({
      registerId: r.id,
      invNo: r.inv_no,
      name: r.name,
      room: r.room,
      responsible: r.responsible,
      serial: r.serial,
      group: r.group_name,
      checkedId: done.get(r.inv_no)?.id ?? null,
      checkedRoom: done.get(r.inv_no)?.locations?.code ?? null,
    }))
    .sort(
      (a, b) =>
        Number(!!a.checkedId) - Number(!!b.checkedId) ||
        Number(normKey(b.room) === here) - Number(normKey(a.room) === here),
    );
}
