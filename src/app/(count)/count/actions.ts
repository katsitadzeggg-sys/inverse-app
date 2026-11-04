'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Product } from '@/types/database';

export type FormState = { error?: string; notice?: string };

const isManager = (role: string) => role === 'owner' || role === 'admin';

/** Owners/admins open a new stocktake; the database gives it its number. */
export async function createStocktake(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'ინვენტარიზაციას მხოლოდ მენეჯერი ხსნის.' };
  const client = String(formData.get('client_name') ?? '').trim();
  const branch = String(formData.get('branch') ?? '').trim();
  const date = String(formData.get('count_date') ?? '').trim();
  if (!client) return { error: 'ჩაწერე კომპანია.' };
  if (!branch) return { error: 'ჩაწერე საწყობი ან ფილიალი.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stocktakes')
    .insert({
      company_id: session.company.id,
      name: `${client} · ${branch}`,
      client_name: client,
      branch,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { count_date: date } : {}),
      created_by: session.userId,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };
  redirect(`/count/${data.id}`);
}

/** T-01, t1, "T 1" and T-001 are the same shelf. */
function normCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9\u10D0-\u10FF]+/g, '')
    .replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
}

type Loc = { id: string; code: string; name: string };

async function findShelf(companyId: string, text: string): Promise<Loc | null> {
  const supabase = await createClient();
  const { data: exact } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('company_id', companyId)
    .ilike('code', text.replace(/[%_]/g, ''))
    .maybeSingle<Loc>();
  if (exact) return exact;
  const want = normCode(text);
  if (!want) return null;
  const { data } = await supabase.from('locations').select('id, code, name').eq('company_id', companyId).limit(5000);
  return ((data ?? []) as Loc[]).find((l) => normCode(l.code) === want) ?? null;
}

/**
 * Text read off a shelf label by the camera (or typed) → the shelf it names,
 * for the counter to confirm. Tries each word of the reading.
 */
export async function matchShelf(text: string): Promise<Loc | null> {
  const session = await requireSession();
  const words = [text, ...text.split(/\s+/)].map((w) => w.trim()).filter((w) => w.length >= 2);
  for (const w of words) {
    const hit = await findShelf(session.company.id, w);
    if (hit) return hit;
  }
  return null;
}

/**
 * The counter scans, reads or types a shelf code. One shelf at a time: while
 * they have an open shelf in this stocktake, another is refused. A shelf that
 * is not in the system can be created on the spot (unnumbered warehouses).
 */
export async function openZone(stocktakeId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  const code = String(formData.get('code') ?? '').trim();
  const create = formData.get('create') === '1';
  const description = String(formData.get('name') ?? '').trim();
  if (!code && !create) return { error: 'დაასკანერე ან ჩაწერე თაროს კოდი.' };

  const supabase = await createClient();

  // One shelf at a time.
  const { data: open } = await supabase
    .from('stocktake_zones')
    .select('location_id, locations (code)')
    .eq('stocktake_id', stocktakeId)
    .eq('counter_id', session.userId)
    .eq('status', 'counting')
    .maybeSingle<{ location_id: string; locations: { code: string } | null }>();

  let location = code ? await findShelf(session.company.id, code) : null;

  if (open && open.location_id !== location?.id) {
    return { error: `ჯერ დახურე თარო ${open.locations?.code ?? ''}, მერე გახსენი ახალი.` };
  }

  if (!location) {
    if (!create) return { error: `თარო „${code}“ სისტემაში არ არის.`, notice: 'missing' };
    let newCode = code;
    if (!newCode) {
      const { data: zs } = await supabase.from('locations').select('code').eq('company_id', session.company.id).like('code', 'Z-%');
      const max = Math.max(0, ...((zs ?? []) as { code: string }[]).map((z) => Number(z.code.slice(2)) || 0));
      newCode = `Z-${String(max + 1).padStart(3, '0')}`;
    }
    const { data: made, error } = await supabase
      .from('locations')
      .insert({ company_id: session.company.id, code: newCode, name: description || newCode, kind: 'shelf' })
      .select('id, code, name')
      .single<Loc>();
    if (error) return { error: error.message };
    location = made;
  }

  const { data: zone } = await supabase
    .from('stocktake_zones')
    .select('id, counter_id, status')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', location.id)
    .maybeSingle<{ id: string; counter_id: string | null; status: string }>();

  if (zone) {
    if (zone.counter_id !== session.userId && !isManager(session.profile.role)) {
      const { data: who } = await supabase
        .from('user_profiles')
        .select('full_name, email')
        .eq('id', zone.counter_id ?? '')
        .maybeSingle<{ full_name: string | null; email: string }>();
      return { error: `თარო ${location.code} ითვლის ${who?.full_name ?? who?.email ?? 'სხვა თანამშრომელი'}.` };
    }
    if (zone.status === 'done') {
      if (!isManager(session.profile.role)) return { error: `თარო ${location.code} უკვე დახურულია. ხელახლა გახსნა მხოლოდ მენეჯერს შეუძლია.` };
      await supabase.from('stocktake_zones').update({ status: 'counting', done_at: null }).eq('id', zone.id);
    }
  } else {
    const { error } = await supabase.from('stocktake_zones').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: location.id,
      counter_id: session.userId,
    });
    if (error) {
      return { error: error.code === '23505' ? 'ჯერ დახურე შენი ღია თარო, ან ამ თაროს სხვა ითვლის.' : error.message };
    }
  }
  redirect(`/count/${stocktakeId}/${location.id}`);
}

/** Close the shelf now: unresolved items freeze and go to the recheck list. */
export async function finishZone(stocktakeId: string, locationId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc('finish_stocktake_zone', { p_stocktake: stocktakeId, p_location: locationId });
  if (error) throw new Error(error.message);
  revalidatePath(`/count/${stocktakeId}`);
  redirect(`/count/${stocktakeId}/${locationId}/done`);
}

/** A note for the whole shelf (damage, mixed goods, no label …). */
export async function saveZoneNote(stocktakeId: string, locationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const note = String(formData.get('note') ?? '').trim().slice(0, 2000);
  const supabase = await createClient();
  const { error } = await supabase
    .from('stocktake_zones')
    .update({ note: note || null })
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId);
  if (error) return { error: error.message };
  revalidatePath(`/count/${stocktakeId}`);
  // The summary page saves the note and then leaves: back to the stocktake or straight to the next shelf.
  const next = String(formData.get('next') ?? '');
  if (next === 'close') redirect(`/count/${stocktakeId}`);
  if (next === 'new') redirect(`/count/${stocktakeId}#shelf`);
  return { notice: 'შენახულია' };
}

export type ProductHit = Pick<Product, 'id' | 'sku' | 'barcode' | 'name' | 'variant' | 'unit'>;

/** Exact barcode or SKU first; otherwise a name search. */
export async function findProducts(query: string): Promise<ProductHit[]> {
  const session = await requireSession();
  const q = query.trim();
  if (!q) return [];
  const supabase = await createClient();
  const cols = 'id, sku, barcode, name, variant, unit';
  const { data: exact } = await supabase
    .from('products')
    .select(cols)
    .eq('company_id', session.company.id)
    .or(`barcode.eq.${q.replace(/[,()]/g, '')},sku.ilike.${q.replace(/[,()%]/g, '')}`)
    .limit(5);
  if (exact && exact.length) return exact as ProductHit[];
  const { data } = await supabase
    .from('products')
    .select(cols)
    .eq('company_id', session.company.id)
    .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
    .order('name')
    .limit(8);
  return (data ?? []) as ProductHit[];
}

export type EntryInput = {
  productId: string | null;
  /** Counting without a product list: a scanned barcode that is not known yet. */
  newBarcode?: string | null;
  newName?: string | null;
  unknownLabel: string | null;
  quantity: number;
  boxes: number | null;
  perBox: number | null;
};

export async function addEntry(stocktakeId: string, locationId: string, input: EntryInput): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  if (!Number.isFinite(input.quantity) || input.quantity < 0) return { error: 'რაოდენობა არასწორია.' };
  const supabase = await createClient();

  // A new barcode becomes a product on the spot, so the next scan finds it.
  if (!input.productId && input.newBarcode?.trim()) {
    const barcode = input.newBarcode.trim();
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('company_id', session.company.id)
      .or(`barcode.eq.${barcode.replace(/[,()]/g, '')},sku.eq.${barcode.replace(/[,()]/g, '')}`)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (existing) input.productId = existing.id;
    else {
      const { data: made, error: pErr } = await supabase
        .from('products')
        .insert({ company_id: session.company.id, sku: barcode, barcode, name: input.newName?.trim() || `ახალი · ${barcode}`, unit: 'ცალი' })
        .select('id')
        .single<{ id: string }>();
      if (pErr) return { error: pErr.message };
      input.productId = made.id;
    }
  }
  if (!input.productId && !input.unknownLabel?.trim()) return { error: 'აირჩიე პროდუქტი ან აღწერე.' };

  const { error } = await supabase.from('stocktake_entries').insert({
    company_id: session.company.id,
    stocktake_id: stocktakeId,
    location_id: locationId,
    product_id: input.productId,
    unknown_label: input.productId ? null : input.unknownLabel!.trim(),
    quantity: input.quantity,
    boxes: input.boxes,
    per_box: input.perBox,
    counter_id: session.userId,
  });
  if (error) return { error: error.message.includes('closed') ? 'ინვენტარიზაცია დახურულია.' : error.message };
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  return { notice: 'ჩაიწერა' };
}

export async function deleteEntry(stocktakeId: string, locationId: string, entryId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.from('stocktake_entries').delete().eq('id', entryId);
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
}

export type RecheckItem = {
  product_id: string;
  product_name: string;
  sku: string;
  status: 'recount' | 'frozen';
  attempts: number;
};

/**
 * Closing a zone compares it with the book (database function, so the book
 * never reaches the phone). Items that do not match come back for recount;
 * after three failed recounts they freeze. With nothing left to recount the
 * zone is done and the counter goes back to the zone list.
 */
export async function closeZone(stocktakeId: string, locationId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('close_stocktake_zone', {
    p_stocktake: stocktakeId,
    p_location: locationId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/count/${stocktakeId}`);
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  const recount = ((data ?? []) as RecheckItem[]).some((r) => r.status === 'recount');
  if (!recount) redirect(`/count/${stocktakeId}/${locationId}/done`);
}

/** A recount replaces the counter's earlier lines for that item on this shelf. */
export async function recountItem(
  stocktakeId: string,
  locationId: string,
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const qty = Number(String(formData.get('qty') ?? '').replace(',', '.'));
  if (String(formData.get('qty') ?? '').trim() === '' || !Number.isFinite(qty) || qty < 0) {
    return { error: 'ჩაწერე რაოდენობა.' };
  }
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from('stocktake_entries')
    .delete()
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .eq('product_id', productId);
  if (delError) return { error: delError.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : delError.message };
  const { error } = await supabase.from('stocktake_entries').insert({
    company_id: session.company.id,
    stocktake_id: stocktakeId,
    location_id: locationId,
    product_id: productId,
    quantity: qty,
    counter_id: session.userId,
    recounted: true,
  });
  if (error) return { error: error.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : error.message };
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  return { notice: 'დადასტურდა' };
}

export type BookRow = {
  code: string;
  barcode: string;
  name: string;
  location: string;
  qty: number;
  cost: number | null;
  unit: string;
};

/** Units as people write them → one spelling. Pieces are the default. */
function normUnit(u: string): string {
  const v = u.trim().toLowerCase().replace(/\.$/, '');
  if (!v || ['ც', 'ცალი', 'pcs', 'pc', 'шт', 'ea', 'unit'].includes(v)) return 'ცალი';
  if (['კგ', 'kg', 'кг'].includes(v)) return 'კგ';
  if (['გრ', 'g', 'гр', 'г'].includes(v)) return 'გრ';
  if (['ლ', 'ლიტრი', 'l', 'л'].includes(v)) return 'ლ';
  if (['მ', 'm', 'м'].includes(v)) return 'მ';
  if (['კოლოფი', 'ყუთი', 'box', 'кор', 'уп'].includes(v)) return 'ყუთი';
  return u.trim();
}

/**
 * Loads the book balance for a stocktake (owners/admins). Products and shelves
 * that are not in the system yet are created from the file, so a client's
 * export can be used as it is. Loading again replaces the previous book.
 */
export async function importBook(stocktakeId: string, rows: BookRow[]): Promise<FormState> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'ნაშთს მხოლოდ მენეჯერი ტვირთავს.' };
  // The barcode stands in for the code when the file has no article number.
  const clean = rows
    .map((r) => {
      const barcode = r.barcode.trim();
      return { ...r, barcode, code: r.code.trim() || barcode, name: r.name.trim(), location: r.location.trim(), unit: normUnit(r.unit), unitGiven: r.unit.trim() !== '' };
    })
    .filter((r) => r.code && Number.isFinite(r.qty));
  if (!clean.length) return { error: 'ფაილში ხაზი ვერ ვიპოვე: საჭიროა შტრიხკოდი (ან კოდი) და ნაშთი.' };
  if (clean.length > 20000) return { error: 'ერთ ჯერზე მაქსიმუმ 20 000 ხაზი.' };

  const supabase = await createClient();
  const company = session.company.id;

  // Products: match by SKU, then by barcode; create the rest.
  const codes = [...new Set(clean.flatMap((r) => [r.code, r.barcode]).filter(Boolean))];
  const products = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500);
    const [{ data: bySku }, { data: byBarcode }] = await Promise.all([
      supabase.from('products').select('id, sku').eq('company_id', company).in('sku', chunk),
      supabase.from('products').select('id, barcode').eq('company_id', company).in('barcode', chunk),
    ]);
    for (const p of byBarcode ?? []) if (p.barcode) products.set(p.barcode, p.id);
    for (const p of bySku ?? []) products.set(p.sku, p.id);
  }
  const known = (r: { code: string; barcode: string }) => products.get(r.code) ?? (r.barcode ? products.get(r.barcode) : undefined);
  const firstByCode = new Map<string, (typeof clean)[number]>();
  for (const r of clean) if (!known(r) && !firstByCode.has(r.code)) firstByCode.set(r.code, r);
  const missing = [...firstByCode.values()];
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500).map((r) => ({
      company_id: company,
      sku: r.code,
      barcode: r.barcode || null,
      name: r.name || r.code,
      unit: r.unit,
    }));
    const { data, error } = await supabase.from('products').insert(chunk).select('id, sku');
    if (error) return { error: `პროდუქტების დამატება ვერ მოხერხდა: ${error.message}` };
    for (const p of data ?? []) products.set(p.sku, p.id);
  }
  // A unit given in the file updates existing products too.
  const unitUpdates = new Map<string, string>();
  for (const r of clean) {
    const id = known(r);
    if (id && r.unitGiven) unitUpdates.set(id, r.unit);
  }
  const byUnit = new Map<string, string[]>();
  for (const [id, unit] of unitUpdates) byUnit.set(unit, [...(byUnit.get(unit) ?? []), id]);
  for (const [unit, ids] of byUnit) {
    for (let i = 0; i < ids.length; i += 300) {
      await supabase.from('products').update({ unit }).in('id', ids.slice(i, i + 300));
    }
  }

  // Shelves: match by code; create the rest.
  const locCodes = [...new Set(clean.map((r) => r.location).filter(Boolean))];
  const locations = new Map<string, string>();
  let newShelves = 0;
  if (locCodes.length) {
    const { data } = await supabase.from('locations').select('id, code').eq('company_id', company).in('code', locCodes);
    for (const l of data ?? []) locations.set(l.code, l.id);
    const newLocs = locCodes.filter((c) => !locations.has(c)).map((code) => ({ company_id: company, code, name: code, kind: 'shelf' as const }));
    newShelves = newLocs.length;
    if (newLocs.length) {
      const { data: made, error } = await supabase.from('locations').insert(newLocs).select('id, code');
      if (error) return { error: `თაროების დამატება ვერ მოხერხდა: ${error.message}` };
      for (const l of made ?? []) locations.set(l.code, l.id);
    }
  }

  // Same item on the same shelf twice in the file: add the quantities up.
  const merged = new Map<string, { product_id: string; location_id: string | null; book_qty: number; unit_cost: number | null }>();
  for (const r of clean) {
    const product_id = known(r)!;
    const location_id = r.location ? locations.get(r.location)! : null;
    const key = `${product_id}|${location_id ?? ''}`;
    const prev = merged.get(key);
    if (prev) prev.book_qty += r.qty;
    else merged.set(key, { product_id, location_id, book_qty: r.qty, unit_cost: r.cost });
  }

  const { error: delError } = await supabase.from('stocktake_book').delete().eq('stocktake_id', stocktakeId);
  if (delError) return { error: delError.message };
  const lines = [...merged.values()].map((m) => ({ ...m, company_id: company, stocktake_id: stocktakeId }));
  for (let i = 0; i < lines.length; i += 1000) {
    const { error } = await supabase.from('stocktake_book').insert(lines.slice(i, i + 1000));
    if (error) return { error: error.message };
  }
  revalidatePath(`/count/${stocktakeId}`);
  return {
    notice: `ჩაიტვირთა ${lines.length} ხაზი. ახალი პროდუქტი: ${missing.length}, ახალი თარო: ${newShelves}.`,
  };
}
