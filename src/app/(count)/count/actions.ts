'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { barcodeVariants, fixDashes, mkhedruli, upperLatin } from '@/lib/text';
import type { Product } from '@/types/database';

export type FormState = { error?: string; notice?: string };

const isManager = (role: string) => role === 'owner' || role === 'admin';

/** Owners/admins open a new stocktake; the database gives it its number. */
export async function createStocktake(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const manager = isManager(session.profile.role);
  const requested = String(formData.get('kind') ?? 'stock');
  // A counter may open one only with the permission, and only in their modules.
  if (
    !manager &&
    !(session.profile.can_open && (session.profile.modules ?? []).includes(requested as never))
  ) {
    return { error: 'ინვენტარიზაციის გახსნის უფლება არ გაქვს. მიმართე მენეჯერს.' };
  }
  const client =
    (manager ? String(formData.get('client_name') ?? '').trim() : '') || session.company.name;
  const branch = String(formData.get('branch') ?? '').trim();
  const date = String(formData.get('count_date') ?? '').trim();
  const address = String(formData.get('address') ?? '')
    .trim()
    .slice(0, 300);
  const lat = Number(formData.get('lat'));
  const lng = Number(formData.get('lng'));
  const point =
    formData.get('lat') && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {};
  const kindRaw = String(formData.get('kind') ?? 'stock');
  const kind = kindRaw === 'expiry' || kindRaw === 'assets' ? kindRaw : 'stock';
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
      kind,
      address: address || null,
      ...point,
      // Counters always open for today; managers may set the date.
      ...(manager && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { count_date: date } : {}),
      created_by: session.userId,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };
  // Fixed assets: start from this object's last register.
  if (kind === 'assets') await supabase.rpc('copy_asset_register', { p_stocktake: data.id });
  else await supabase.rpc('copy_stock_book', { p_stocktake: data.id }); // stock / expiry: the object's last book
  // Counter's fixed assets: the first room is typed on the same form — straight into it.
  const room = String(formData.get('room') ?? '').trim();
  if (!manager && kind === 'assets' && room) {
    const fd = new FormData();
    fd.set('code', room);
    fd.set('create', '1');
    fd.set('name', room);
    if ('lat' in point) {
      fd.set('lat', String(point.lat));
      fd.set('lng', String(point.lng));
    }
    await openZone(data.id, {}, fd); // redirects into the room
  }
  redirect(manager ? `/manage/${data.id}` : `/count/${data.id}`);
}

/** T-01, t1, "T 1" and T-001 are the same shelf. */
function normCode(code: string): string {
  // Latin letters to upper case only: toUpperCase() would turn Georgian into
  // Mtavruli and the regex below would then drop every Georgian letter.
  return upperLatin(mkhedruli(code))
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
  const { data } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('company_id', companyId)
    .limit(5000);
  return ((data ?? []) as Loc[]).find((l) => normCode(l.code) === want) ?? null;
}

/**
 * Text read off a shelf label by the camera (or typed) → the shelf it names,
 * for the counter to confirm. Tries each word of the reading.
 */
export async function matchShelf(text: string): Promise<Loc | null> {
  const session = await requireSession();
  text = fixDashes(text);
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
export async function openZone(
  stocktakeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  {
    const supabase = await createClient();
    const { data: allowed } = await supabase.rpc('can_count_in', { p_stocktake: stocktakeId });
    if (allowed === false)
      return { error: 'ამ ინვენტარიზაციაზე არ ხარ დანიშნული. მიმართე მენეჯერს.' };
  }
  const code = fixDashes(String(formData.get('code') ?? '').trim());
  if (/^(https?:\/\/|www\.)/i.test(code))
    return { error: 'ეს ვებ-ლინკის QR-ია, თაროს კოდი არ არის. დაასკანერე თაროს ეტიკეტი.' };
  const create = formData.get('create') === '1';
  // Where the phone was when the shelf was opened (if the person allowed it).
  const gLat = Number(formData.get('lat'));
  const gLng = Number(formData.get('lng'));
  const gAcc = Number(formData.get('acc'));
  const position =
    formData.get('lat') && Number.isFinite(gLat) && Number.isFinite(gLng)
      ? {
          lat: gLat,
          lng: gLng,
          accuracy_m: Number.isFinite(gAcc) ? gAcc : null,
          located_at: new Date().toISOString(),
        }
      : {};
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

  // "Next room" on the room page: the room being left is closed on the way.
  // Fixed assets: opening another room closes the one left open.
  const { data: stKind } = await supabase
    .from('stocktakes')
    .select('kind')
    .eq('id', stocktakeId)
    .maybeSingle<{ kind: string }>();
  const closing =
    String(formData.get('close') ?? '') ||
    (stKind?.kind === 'assets' && open ? open.location_id : '');
  if (open && closing && open.location_id === closing && open.location_id !== location?.id) {
    const { error } = await supabase.rpc('finish_stocktake_zone', {
      p_stocktake: stocktakeId,
      p_location: closing,
    });
    if (error) return { error: error.message };
  } else if (open && open.location_id !== location?.id) {
    return { error: `ჯერ დახურე ${open.locations?.code ?? ''}, მერე გახსენი ახალი.` };
  }

  if (!location) {
    if (!create) return { error: `თარო „${code}“ სისტემაში არ არის.`, notice: 'missing' };
    let newCode = code;
    if (!newCode) {
      const { data: zs } = await supabase
        .from('locations')
        .select('code')
        .eq('company_id', session.company.id)
        .like('code', 'Z-%');
      const max = Math.max(
        0,
        ...((zs ?? []) as { code: string }[]).map((z) => Number(z.code.slice(2)) || 0),
      );
      newCode = `Z-${String(max + 1).padStart(3, '0')}`;
    }
    const { data: made, error } = await supabase
      .from('locations')
      .insert({
        company_id: session.company.id,
        code: newCode,
        name: description || newCode,
        kind: 'shelf',
      })
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
      return {
        error: `${location.code}-ს ითვლის ${who?.full_name ?? who?.email ?? 'სხვა თანამშრომელი'}.`,
      };
    }
    if (zone.status === 'done') {
      if (!isManager(session.profile.role))
        return {
          error: `${location.code} უკვე დახურულია. ხელახლა გახსნა მხოლოდ მენეჯერს შეუძლია.`,
        };
      await supabase
        .from('stocktake_zones')
        .update({ status: 'counting', done_at: null, ...position })
        .eq('id', zone.id);
    } else if ('lat' in position) {
      await supabase.from('stocktake_zones').update(position).eq('id', zone.id);
    }
  } else {
    const { error } = await supabase.from('stocktake_zones').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: location.id,
      counter_id: session.userId,
      ...position,
    });
    if (error) {
      return {
        error:
          error.code === '23505'
            ? 'ჯერ დახურე შენი ღია თარო / ოთახი, ან ამას სხვა ითვლის.'
            : error.message,
      };
    }
  }
  redirect(`/count/${stocktakeId}/${location.id}`);
}

/** Close the shelf now: unresolved items freeze and go to the recheck list. */
export async function finishZone(stocktakeId: string, locationId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc('finish_stocktake_zone', {
    p_stocktake: stocktakeId,
    p_location: locationId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/count/${stocktakeId}`);
  redirect(`/count/${stocktakeId}/${locationId}/done`);
}

/** Fixed assets: close the room and stay on the stocktake page to open the next one. */
export async function finishRoom(stocktakeId: string, locationId: string): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc('finish_stocktake_zone', {
    p_stocktake: stocktakeId,
    p_location: locationId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/count/${stocktakeId}`);
  redirect(`/count/${stocktakeId}`);
}

/** A note for the whole shelf (damage, mixed goods, no label …). */
export async function saveZoneNote(
  stocktakeId: string,
  locationId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, 2000);
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
    .eq('active', true)
    .or(
      barcodeVariants(q.replace(/[,()%]/g, ''))
        .flatMap((v) => [`barcode.eq.${v}`, `sku.ilike.${v}`])
        .join(','),
    )
    .limit(5);
  if (exact && exact.length) return exact as ProductHit[];
  const { data } = await supabase
    .from('products')
    .select(cols)
    .eq('company_id', session.company.id)
    .eq('active', true)
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
  /** New product's unit (ცალი, კგ, ლ, ყუთი…) and variant (ზომა, ფერი, გემო). */
  newUnit?: string | null;
  newVariant?: string | null;
  /** New product's factory serial, group (category) and a free comment. */
  newSerial?: string | null;
  newGroup?: string | null;
  newNote?: string | null;
  /** Storage path of the new product's photo (stocktake-media). */
  newPhoto?: string | null;
  unknownLabel: string | null;
  quantity: number;
  boxes: number | null;
  perBox: number | null;
  /** Expiry-date count: YYYY-MM-DD, or null when the date is unknown. */
  expiryDate?: string | null;
};

export async function addEntry(
  stocktakeId: string,
  locationId: string,
  input: EntryInput,
): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  if (!Number.isFinite(input.quantity) || input.quantity < 0)
    return { error: 'რაოდენობა არასწორია.' };
  const supabase = await createClient();

  // A shelf's own QR read by mistake must not become a product.
  const newCodeTyped = input.newBarcode?.trim();
  if (!input.productId && newCodeTyped) {
    const { data: shelf } = await supabase
      .from('locations')
      .select('id')
      .ilike('code', newCodeTyped)
      .limit(1)
      .maybeSingle();
    if (shelf) return { error: `„${newCodeTyped}“ თაროს კოდია, პროდუქტი არ არის.` };
  }

  // New product's group: an existing category of the company, or a new one.
  let categoryId: string | null = null;
  const group = input.newGroup?.trim();
  if (!input.productId && group) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .eq('company_id', session.company.id)
      .ilike('name', group)
      .limit(1)
      .maybeSingle<{ id: string }>();
    categoryId = cat?.id ?? null;
    if (!categoryId) {
      const { data: made } = await supabase
        .from('categories')
        .insert({ company_id: session.company.id, name: group })
        .select('id')
        .single<{ id: string }>();
      categoryId = made?.id ?? null;
    }
  }
  const description =
    [input.newSerial?.trim() && `სერიული №: ${input.newSerial.trim()}`, input.newNote?.trim()]
      .filter(Boolean)
      .join('\n') || null;

  // A new barcode becomes a product on the spot, so the next scan finds it.
  // No barcode but a name: the product gets a code of its own (N-…).
  if (!input.productId && !input.newBarcode?.trim() && input.newName?.trim()) {
    const { data: made, error: pErr } = await supabase
      .from('products')
      .insert({
        company_id: session.company.id,
        sku: `N-${Date.now().toString(36).toUpperCase()}`,
        barcode: null,
        name: input.newName.trim(),
        variant: input.newVariant?.trim() || null,
        unit: input.newUnit?.trim() || 'ცალი',
        category_id: categoryId,
        description,
        image_url: input.newPhoto ?? null,
      })
      .select('id')
      .single<{ id: string }>();
    if (pErr) return { error: pErr.message };
    input.productId = made.id;
  }
  if (!input.productId && input.newBarcode?.trim()) {
    const barcode = input.newBarcode.trim();
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('company_id', session.company.id)
      .or(
        barcodeVariants(barcode.replace(/[,()%]/g, ''))
          .flatMap((v) => [`barcode.eq.${v}`, `sku.eq.${v}`])
          .join(','),
      )
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (existing) input.productId = existing.id;
    else {
      const { data: made, error: pErr } = await supabase
        .from('products')
        .insert({
          company_id: session.company.id,
          sku: barcode,
          barcode,
          name: input.newName?.trim() || `ახალი · ${barcode}`,
          variant: input.newVariant?.trim() || null,
          unit: input.newUnit?.trim() || 'ცალი',
          category_id: categoryId,
          description,
          image_url: input.newPhoto ?? null,
        })
        .select('id')
        .single<{ id: string }>();
      if (pErr) return { error: pErr.message };
      input.productId = made.id;
    }
  }
  if (!input.productId && !input.unknownLabel?.trim())
    return { error: 'აირჩიე პროდუქტი ან აღწერე.' };

  // Safety net: the same line sent twice within a few seconds (a phone glitch,
  // a double tap) is written once.
  if (input.productId) {
    const { data: twin } = await supabase
      .from('stocktake_entries')
      .select('id')
      .eq('stocktake_id', stocktakeId)
      .eq('location_id', locationId)
      .eq('product_id', input.productId)
      .eq('quantity', input.quantity)
      .eq('counter_id', session.userId)
      .gte('created_at', new Date(Date.now() - 3000).toISOString())
      .limit(1);
    if (twin?.length) return { notice: 'ჩაიწერა' };
  }

  const { error } = await supabase.from('stocktake_entries').insert({
    company_id: session.company.id,
    stocktake_id: stocktakeId,
    location_id: locationId,
    product_id: input.productId,
    unknown_label: input.productId ? null : input.unknownLabel!.trim(),
    quantity: input.quantity,
    boxes: input.boxes,
    per_box: input.perBox,
    expiry_date:
      input.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate) ? input.expiryDate : null,
    counter_id: session.userId,
    // The photo taken for this very line (new product) stays with the line.
    photo_path: input.newPhoto ?? null,
  });
  if (error)
    return {
      error: error.message.includes('closed') ? 'ინვენტარიზაცია დახურულია.' : error.message,
    };
  revalidatePath(`/count/${stocktakeId}/${locationId}`);
  return { notice: 'ჩაიწერა' };
}

/** The product's photo (taken when it was added), for "🖼 photo" while counting. */
export async function productPhoto(productId: string): Promise<string | null> {
  await requireSession();
  const supabase = await createClient();
  const { data: p } = await supabase
    .from('products')
    .select('image_url')
    .eq('id', productId)
    .maybeSingle<{ image_url: string | null }>();
  let path = p?.image_url ?? null;
  if (!path) {
    const { data: e } = await supabase
      .from('stocktake_entries')
      .select('photo_path')
      .eq('product_id', productId)
      .not('photo_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ photo_path: string }>();
    path = e?.photo_path ?? null;
  }
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await supabase.storage.from('stocktake-media').createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

export async function deleteEntry(
  stocktakeId: string,
  locationId: string,
  entryId: string,
): Promise<void> {
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

/**
 * The recount list in one step: every quantity typed in is saved (replacing
 * the earlier lines for that item), then the shelf is checked against the book
 * again. Items left empty count as not found (0).
 */
export async function recountAll(
  stocktakeId: string,
  locationId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const supabase = await createClient();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty:')) continue;
    const productId = key.slice(4);
    const raw = String(value).trim();
    const qty = raw === '' ? 0 : Number(raw.replace(',', '.'));
    if (!Number.isFinite(qty) || qty < 0) return { error: 'რაოდენობა არასწორია.' };
    const { error: delError } = await supabase
      .from('stocktake_entries')
      .delete()
      .eq('stocktake_id', stocktakeId)
      .eq('location_id', locationId)
      .eq('product_id', productId);
    if (delError)
      return {
        error: delError.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : delError.message,
      };
    const { error } = await supabase.from('stocktake_entries').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: locationId,
      product_id: productId,
      quantity: qty,
      counter_id: session.userId,
      recounted: true,
    });
    if (error)
      return { error: error.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : error.message };
  }
  await closeZone(stocktakeId, locationId); // checks again; redirects when nothing is left
  return { notice: 'ok' };
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
  // Expiry-date count: one line per batch, sent as JSON [{ qty, expiry }].
  let lines: { qty: number; expiry: string | null }[];
  const batches = formData.get('batches');
  if (batches) {
    try {
      lines = (JSON.parse(String(batches)) as { qty: unknown; expiry: unknown }[])
        .map((b) => ({
          qty: Number(b.qty),
          expiry:
            typeof b.expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.expiry) ? b.expiry : null,
        }))
        .filter((b) => Number.isFinite(b.qty) && b.qty >= 0);
    } catch {
      return { error: 'მონაცემები ვერ წავიკითხე.' };
    }
    if (!lines.length) return { error: 'ჩაწერე რაოდენობა.' };
  } else {
    const qty = Number(String(formData.get('qty') ?? '').replace(',', '.'));
    if (String(formData.get('qty') ?? '').trim() === '' || !Number.isFinite(qty) || qty < 0) {
      return { error: 'ჩაწერე რაოდენობა.' };
    }
    lines = [{ qty, expiry: null }];
  }
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from('stocktake_entries')
    .delete()
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .eq('product_id', productId);
  if (delError)
    return {
      error: delError.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : delError.message,
    };
  const { error } = await supabase.from('stocktake_entries').insert(
    lines.map((l) => ({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: locationId,
      product_id: productId,
      quantity: l.qty,
      expiry_date: l.expiry,
      counter_id: session.userId,
      recounted: true,
    })),
  );
  if (error)
    return { error: error.message.includes('frozen') ? 'ეს პოზიცია გაყინულია.' : error.message };
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
  /** YYYY-MM-DD; expiry-date counts keep the book per batch. */
  expiry?: string | null;
  /** Product group (category), e.g. სასმელები. */
  group?: string;
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
/**
 * Loads a book file. Large files come in parts (the browser sends ~1 000 rows
 * at a time): the first part replaces the old book, the rest are appended.
 */
export async function importBook(
  stocktakeId: string,
  rows: BookRow[],
  append = false,
): Promise<FormState & { lines?: number; created?: number; shelves?: number }> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'ნაშთს მხოლოდ მენეჯერი ტვირთავს.' };
  // The barcode stands in for the code when the file has no article number.
  const clean = rows
    .map((r) => {
      const barcode = r.barcode.trim();
      return {
        ...r,
        barcode,
        code: r.code.trim() || barcode,
        name: r.name.trim(),
        // "0" or a bare dash in the file means the item has no shelf.
        location: /^(0+|[-–—]+)$/.test(r.location.trim()) ? '' : r.location.trim(),
        unit: normUnit(r.unit),
        unitGiven: r.unit.trim() !== '',
      };
    })
    .filter((r) => r.code && Number.isFinite(r.qty));
  if (!clean.length)
    return { error: 'ფაილში ხაზი ვერ ვიპოვე: საჭიროა შტრიხკოდი (ან კოდი) და ნაშთი.' };
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
      supabase
        .from('products')
        .select('id, barcode')
        .eq('company_id', company)
        .in('barcode', chunk),
    ]);
    for (const p of byBarcode ?? []) if (p.barcode) products.set(p.barcode, p.id);
    for (const p of bySku ?? []) products.set(p.sku, p.id);
  }
  const known = (r: { code: string; barcode: string }) =>
    products.get(r.code) ?? (r.barcode ? products.get(r.barcode) : undefined);
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
  // Groups: the file's group names become categories; every product in the file gets its group.
  const groupNames = [...new Set(clean.map((r) => (r.group ?? '').trim()).filter(Boolean))];
  if (groupNames.length) {
    const cats = new Map<string, string>();
    const { data: have } = await supabase
      .from('categories')
      .select('id, name')
      .eq('company_id', company);
    for (const c of have ?? []) cats.set(c.name.trim().toLowerCase(), c.id);
    const toMake = groupNames.filter((g) => !cats.has(g.toLowerCase()));
    if (toMake.length) {
      const { data: made } = await supabase
        .from('categories')
        .insert(toMake.map((name) => ({ company_id: company, name })))
        .select('id, name');
      for (const c of made ?? []) cats.set(c.name.trim().toLowerCase(), c.id);
    }
    const byCat = new Map<string, Set<string>>();
    for (const r of clean) {
      const g = (r.group ?? '').trim().toLowerCase();
      const id = known(r);
      const cat = g ? cats.get(g) : undefined;
      if (id && cat) byCat.set(cat, (byCat.get(cat) ?? new Set()).add(id));
    }
    for (const [cat, ids] of byCat) {
      const list = [...ids];
      for (let i = 0; i < list.length; i += 300)
        await supabase
          .from('products')
          .update({ category_id: cat })
          .in('id', list.slice(i, i + 300));
    }
  }

  // A product that so far has only its code as a name takes the file's name.
  {
    const named = new Map<string, string>();
    for (const r of clean) {
      const id = known(r);
      if (id && r.name && r.name !== r.code && r.name !== r.barcode) named.set(id, r.name);
    }
    const ids = [...named.keys()];
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, barcode')
        .in('id', ids.slice(i, i + 300));
      for (const p of data ?? [])
        if (p.name === p.sku || p.name === p.barcode || p.name.startsWith('ახალი · '))
          await supabase
            .from('products')
            .update({ name: named.get(p.id)! })
            .eq('id', p.id);
    }
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
      await supabase
        .from('products')
        .update({ unit })
        .in('id', ids.slice(i, i + 300));
    }
  }

  // Shelves: match by code; create the rest.
  const locCodes = [...new Set(clean.map((r) => r.location).filter(Boolean))];
  const locations = new Map<string, string>();
  let newShelves = 0;
  if (locCodes.length) {
    for (let i = 0; i < locCodes.length; i += 500) {
      const { data } = await supabase
        .from('locations')
        .select('id, code')
        .eq('company_id', company)
        .in('code', locCodes.slice(i, i + 500));
      for (const l of data ?? []) locations.set(l.code, l.id);
    }
    const newLocs = locCodes
      .filter((c) => !locations.has(c))
      .map((code) => ({ company_id: company, code, name: code, kind: 'shelf' as const }));
    newShelves = newLocs.length;
    if (newLocs.length) {
      const { data: made, error } = await supabase
        .from('locations')
        .insert(newLocs)
        .select('id, code');
      if (error) return { error: `თაროების დამატება ვერ მოხერხდა: ${error.message}` };
      for (const l of made ?? []) locations.set(l.code, l.id);
    }
  }

  // Same item on the same shelf twice in the file: add the quantities up.
  const merged = new Map<
    string,
    {
      product_id: string;
      location_id: string | null;
      book_qty: number;
      unit_cost: number | null;
      expiry_date: string | null;
    }
  >();
  for (const r of clean) {
    const product_id = known(r)!;
    const location_id = r.location ? locations.get(r.location)! : null;
    const expiry_date = r.expiry && /^\d{4}-\d{2}-\d{2}$/.test(r.expiry) ? r.expiry : null;
    const key = `${product_id}|${location_id ?? ''}|${expiry_date ?? ''}`;
    const prev = merged.get(key);
    if (prev) prev.book_qty += r.qty;
    else
      merged.set(key, { product_id, location_id, book_qty: r.qty, unit_cost: r.cost, expiry_date });
  }

  if (!append) {
    const { error: delError } = await supabase
      .from('stocktake_book')
      .delete()
      .eq('stocktake_id', stocktakeId);
    if (delError) return { error: delError.message };
  }
  const lines = [...merged.values()].map((m) => ({
    ...m,
    company_id: company,
    stocktake_id: stocktakeId,
  }));
  for (let i = 0; i < lines.length; i += 1000) {
    const { error } = await supabase.from('stocktake_book').insert(lines.slice(i, i + 1000));
    if (error) return { error: error.message };
  }
  revalidatePath(`/count/${stocktakeId}`);
  return {
    notice: `ჩაიტვირთა ${lines.length} ხაზი. ახალი პროდუქტი: ${missing.length}, ახალი თარო: ${newShelves}.`,
    lines: lines.length,
    created: missing.length,
    shelves: newShelves,
  };
}

/** Signed links for the shelf photos/videos, for the ZIP download. */
export async function mediaForExport(
  stocktakeId: string,
  shelf: string,
): Promise<{ name: string; url: string }[]> {
  await requireSession();
  const supabase = await createClient();
  let q = supabase
    .from('stocktake_media')
    .select('path, kind, poster_path, created_at, locations (code), asset_checks (inv_no)')
    .eq('stocktake_id', stocktakeId)
    .order('created_at');
  if (shelf !== 'all') q = q.eq('location_id', shelf);
  const { data } = await q.returns<
    {
      path: string;
      kind: string;
      poster_path: string | null;
      created_at: string;
      locations: { code: string } | null;
      asset_checks: { inv_no: string } | null;
    }[]
  >();
  const counters = new Map<string, number>();
  const sign = async (path: string) =>
    (await supabase.storage.from('stocktake-media').createSignedUrl(path, 60 * 30)).data
      ?.signedUrl ?? '';
  const files = await Promise.all(
    (data ?? []).map(async (m) => {
      // Fixed assets: one folder per inventory number; otherwise per shelf.
      const folder = (m.asset_checks?.inv_no ?? m.locations?.code ?? 'თარო').replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
      const n = (counters.get(folder) ?? 0) + 1;
      counters.set(folder, n);
      const ext = m.path.split('.').pop() ?? (m.kind === 'video' ? 'mp4' : 'jpg');
      const name = `${folder}/${folder}_${String(n).padStart(2, '0')}`;
      const out = [{ name: `${name}.${ext}`, url: await sign(m.path) }];
      // A video's captioned poster frame goes next to it.
      if (m.poster_path) out.push({ name: `${name}_გარეკანი.jpg`, url: await sign(m.poster_path) });
      return out;
    }),
  );
  return files.flat();
}

/** Owners/admins close a stocktake (no more counting) or reopen it. */
export async function setStocktakeStatus(
  stocktakeId: string,
  status: 'open' | 'closed',
): Promise<void> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return;
  const supabase = await createClient();
  await supabase
    .from('stocktakes')
    .update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null })
    .eq('id', stocktakeId);
  revalidatePath(`/manage/${stocktakeId}`);
  revalidatePath('/manage');
  revalidatePath('/manage/stocktakes');
  // Closed: straight back to the list.
  if (status === 'closed') redirect('/manage/stocktakes');
}

/** Archive (hide everywhere, keep all data) or bring back from the archive. */
export async function setStocktakeArchived(stocktakeId: string, archived: boolean): Promise<void> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return;
  const supabase = await createClient();
  await supabase
    .from('stocktakes')
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      ...(archived ? { status: 'closed', closed_at: new Date().toISOString() } : {}),
    })
    .eq('id', stocktakeId);
  revalidatePath(`/manage/${stocktakeId}`);
  revalidatePath('/manage');
  revalidatePath('/manage/stocktakes');
  revalidatePath('/count');
  // Archived: straight back to the list.
  if (archived) redirect('/manage/stocktakes');
}

/** The manager picks who counts in this stocktake. Nobody ticked = whole team. */
export async function setStocktakeMembers(
  stocktakeId: string,
  memberIds: string[],
): Promise<{ error?: string }> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return { error: 'მხოლოდ მენეჯერს შეუძლია.' };
  const ids = memberIds.filter((v) => /^[0-9a-f-]{36}$/.test(v));
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from('stocktake_members')
    .delete()
    .eq('stocktake_id', stocktakeId);
  if (delError) return { error: delError.message };
  if (ids.length) {
    const { error } = await supabase.from('stocktake_members').insert(
      ids.map((user_id) => ({
        stocktake_id: stocktakeId,
        user_id,
        company_id: session.company.id,
      })),
    );
    if (error) return { error: error.message };
  }
  revalidatePath(`/manage/${stocktakeId}`);
  revalidatePath('/count');
  revalidatePath('/stock');
  return {};
}

/** Product groups (categories) of the company, for the new-product form. */
export async function productGroups(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from('categories').select('name').order('name').limit(500);
  return [...new Set((data ?? []).map((c) => c.name as string))];
}

/** What has been counted on this shelf so far, per product (for "already scanned"). */
export async function shelfCounts(
  stocktakeId: string,
  locationId: string,
): Promise<Record<string, number>> {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from('stocktake_entries')
    .select('product_id, quantity')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .not('product_id', 'is', null)
    .limit(5000);
  const out: Record<string, number> = {};
  for (const r of data ?? [])
    out[r.product_id as string] = (out[r.product_id as string] ?? 0) + Number(r.quantity);
  return out;
}

/** The company's products, kept on the phone so scans are recognised with no connection. */
export async function productCatalog(): Promise<ProductHit[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const out: ProductHit[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await supabase
      .from('products')
      .select('id, sku, barcode, name, variant, unit')
      .eq('company_id', session.company.id)
      .eq('active', true)
      .range(from, from + 999);
    out.push(...((data ?? []) as ProductHit[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Shelves each product is booked on (codes only), for "this item belongs on another shelf". */
export async function bookShelves(
  stocktakeId: string,
): Promise<{ product_id: string; location_id: string; code: string; shelf_done: boolean }[]> {
  await requireSession();
  const supabase = await createClient();
  type Row = { product_id: string; location_id: string; code: string; shelf_done: boolean };
  // The server hands out at most 1 000 rows per call: a big book is read in pages.
  const out: Row[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data } = await supabase
      .rpc('book_shelves', { p_stocktake: stocktakeId })
      .range(from, from + 999);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** All shelf codes of the company (a shelf QR read as a product is ignored). */
export async function shelfCodeList(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const out: string[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase
      .from('locations')
      .select('code')
      .eq('kind', 'shelf')
      .order('code')
      .range(from, from + 999);
    out.push(...(data ?? []).map((l) => l.code as string));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Book quantity per product on this shelf — empty when the stocktake hides the book. */
export async function shelfBook(
  stocktakeId: string,
  locationId: string,
): Promise<Record<string, number>> {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.rpc('shelf_book', {
    p_stocktake: stocktakeId,
    p_location: locationId,
  });
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { product_id: string; qty: number }[])
    out[r.product_id] = Number(r.qty);
  return out;
}

/**
 * The counter corrects a product already counted on this shelf: its total
 * here becomes `qty` (the counter's own lines are replaced by one line).
 * Not possible once the shelf is closed.
 */
export async function setShelfQty(
  stocktakeId: string,
  locationId: string,
  productId: string,
  qty: number,
): Promise<FormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'შენს როლს დათვლა არ შეუძლია.' };
  if (!Number.isFinite(qty) || qty < 0) return { error: 'რაოდენობა არასწორია.' };
  const supabase = await createClient();
  const { data: zone } = await supabase
    .from('stocktake_zones')
    .select('status')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .maybeSingle<{ status: string }>();
  if (zone?.status === 'done') return { error: 'თარო დახურულია — ჩასწორება აღარ შეიძლება.' };

  const { data: rows } = await supabase
    .from('stocktake_entries')
    .select('id, quantity, counter_id')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .eq('product_id', productId);
  const mine = (rows ?? []).filter((r) => r.counter_id === session.userId);
  const others = (rows ?? [])
    .filter((r) => r.counter_id !== session.userId)
    .reduce((t, r) => t + Number(r.quantity), 0);
  if (qty < others) return { error: `სხვა აღწერის თანამშრომელს აქ უკვე ჩაწერილი აქვს ${others}.` };
  if (mine.length) {
    const { error } = await supabase
      .from('stocktake_entries')
      .delete()
      .in(
        'id',
        mine.map((r) => r.id),
      );
    if (error) return { error: error.message };
  }
  if (qty - others > 0) {
    const { error } = await supabase.from('stocktake_entries').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: locationId,
      product_id: productId,
      quantity: qty - others,
      counter_id: session.userId,
    });
    if (error) return { error: error.message };
  }
  return { notice: 'ჩასწორდა' };
}

/** A product that came in with only a code gets its name from the counter. */
export async function nameProduct(productId: string, name: string): Promise<FormState> {
  await requireSession();
  const n = name.trim();
  if (!n) return { error: 'ჩაწერე დასახელება.' };
  // Counters cannot edit products; the database names only a code-only product.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('name_product', {
    p_product: productId,
    p_name: n,
  });
  if (error) return { error: error.message };
  return data ? { notice: data as string } : { error: 'პროდუქტი ვერ მოიძებნა.' };
}

/** Manager: counters see (or do not see) the book quantity of the shelf. */
export async function setShowBook(stocktakeId: string, show: boolean): Promise<void> {
  const session = await requireSession();
  if (!isManager(session.profile.role)) return;
  const supabase = await createClient();
  await supabase.from('stocktakes').update({ show_book: show }).eq('id', stocktakeId);
  revalidatePath(`/manage/${stocktakeId}`);
}

/** The counter's "I'm done with this stocktake" (or back to counting). */
export async function setMyCountFinished(stocktakeId: string, finished: boolean): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_my_count_finished', {
    p_stocktake: stocktakeId,
    p_finished: finished,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/count/${stocktakeId}`);
  revalidatePath(`/manage/${stocktakeId}`);
}

export type MediaItem = {
  url: string;
  kind: 'photo' | 'video';
  poster: string | null;
  caption: string | null;
};

/** A shelf's own photos/videos (not single-line product photos), for the viewer. */
export async function shelfMedia(stocktakeId: string, locationId: string): Promise<MediaItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from('stocktake_media')
    .select('path, kind, poster_path, caption')
    .eq('stocktake_id', stocktakeId)
    .eq('location_id', locationId)
    .order('created_at')
    .returns<
      { path: string; kind: string; poster_path: string | null; caption: string | null }[]
    >();
  const rows = (data ?? []).filter((m) => !/\/product-[^/]+$/.test(m.path));
  const paths = rows.flatMap((m) => [m.path, ...(m.poster_path ? [m.poster_path] : [])]);
  if (!paths.length) return [];
  const { data: signed } = await supabase.storage
    .from('stocktake-media')
    .createSignedUrls(paths, 60 * 60);
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((m) => ({
    url: url.get(m.path) ?? '',
    kind: m.kind === 'video' ? 'video' : 'photo',
    poster: m.poster_path ? (url.get(m.poster_path) ?? null) : null,
    caption: m.caption,
  }));
}
