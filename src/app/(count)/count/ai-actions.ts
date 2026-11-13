'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { analyzeShelfImages, type ShelfImage } from '@/lib/verification/analyze';
import type { CatalogueEntry } from '@/lib/verification/prompt';
import { grade } from '@/lib/verification/grade';
import { identifyProduct, type Candidate } from '@/lib/verification/identify';
import { findProducts, type ProductHit } from './actions';

export type AiItem = {
  name: string;
  code: string;
  counted: number | null;
  detected: number;
  confidence: number;
  status: 'match' | 'partial' | 'mismatch' | 'unknown';
  needsBarcode: boolean;
  notes: string;
};
export type AiResult = {
  summary: string;
  quality: 'good' | 'fair' | 'poor';
  items: AiItem[];
};

const MAX_PHOTOS = 12;

/**
 * Checks a closed shelf by its photos and video frames: a vision model counts
 * what it can see of each product counted there, and every product whose
 * visible count differs from the entered one is flagged for a manager.
 */
export async function aiCheckShelf(
  stocktakeId: string,
  locationId: string,
  frames: string[],
): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.profile.role !== 'owner' && session.profile.role !== 'admin')
    return { error: 'შემოწმებას მხოლოდ მენეჯერი უშვებს.' };
  if (!process.env.ANTHROPIC_API_KEY)
    return { error: 'AI-ს გასაღები (ANTHROPIC_API_KEY) Vercel-ში ჯერ არ ჩაწერილა.' };
  const supabase = await createClient();

  const [{ data: location }, { data: entries }, { data: book }, { data: media }] =
    await Promise.all([
      supabase.from('locations').select('code, name').eq('id', locationId).maybeSingle(),
      supabase
        .from('stocktake_entries')
        .select('product_id, quantity')
        .eq('stocktake_id', stocktakeId)
        .eq('location_id', locationId)
        .not('product_id', 'is', null),
      supabase
        .from('stocktake_book')
        .select('product_id')
        .eq('stocktake_id', stocktakeId)
        .eq('location_id', locationId),
      supabase
        .from('stocktake_media')
        .select('path, kind, poster_path')
        .eq('stocktake_id', stocktakeId)
        .eq('location_id', locationId)
        .order('created_at'),
    ]);
  if (!location) return { error: 'თარო ვერ ვიპოვე.' };

  const counted = new Map<string, number>();
  for (const e of entries ?? [])
    counted.set(
      e.product_id as string,
      (counted.get(e.product_id as string) ?? 0) + Number(e.quantity),
    );
  for (const b of book ?? [])
    if (!counted.has(b.product_id as string)) counted.set(b.product_id as string, 0);
  if (!counted.size) return { error: 'ამ თაროზე შესამოწმებელი პროდუქტი არ არის.' };

  const { data: prods } = await supabase
    .from('products')
    .select('id, sku, name, brand, variant, barcode, visual_notes, unit')
    .in('id', [...counted.keys()]);
  const catalogue: CatalogueEntry[] = (prods ?? []).map((p) => ({
    sku: p.barcode || p.sku,
    name: p.name,
    brand: p.brand,
    variant: p.variant,
    barcode: null,
    visual_notes: p.visual_notes,
    unit: p.unit || 'ცალი',
    expected_quantity: counted.get(p.id) ?? 0,
  }));
  const byCode = new Map((prods ?? []).map((p) => [p.barcode || p.sku, p]));

  // The shelf's own photos (not photos of single new products) + video frames.
  const images: ShelfImage[] = [];
  // A video's poster frame always goes in; more frames come from the browser
  // when it can decode the video.
  const paths = (media ?? [])
    .filter((x) => !/\/product-[^/]+$/.test(x.path))
    .map((x) => (x.kind === 'video' ? x.poster_path : x.path))
    .filter((x): x is string => !!x)
    .slice(0, MAX_PHOTOS);
  for (const path of paths) {
    const { data } = await supabase.storage.from('stocktake-media').download(path);
    if (!data) continue;
    const type = data.type === 'image/png' || data.type === 'image/webp' ? data.type : 'image/jpeg';
    images.push({ data: Buffer.from(await data.arrayBuffer()), mediaType: type });
  }
  for (const f of frames.slice(0, 16)) {
    const b64 = f.replace(/^data:image\/jpeg;base64,/, '');
    if (b64.length > 20) images.push({ data: Buffer.from(b64, 'base64'), mediaType: 'image/jpeg' });
  }
  if (!images.length) return { error: 'ამ თაროს ფოტო ან ვიდეო არ აქვს.' };

  try {
    const { analysis, model, inputTokens, outputTokens } = await analyzeShelfImages({
      images,
      location: { code: location.code, name: location.name },
      catalogue,
    });
    const items: AiItem[] = [];
    const seen = new Set<string>();
    for (const o of analysis.observations) {
      const p = byCode.get(o.sku);
      if (p) seen.add(o.sku);
      const exp = p ? (counted.get(p.id) ?? 0) : null;
      const g = grade(o, exp);
      items.push({
        name: p?.name ?? (o.notes.slice(0, 120) || 'უცნობი'),
        code: p ? o.sku : '',
        counted: exp,
        detected: g.detected,
        confidence: g.confidence,
        status: g.status,
        needsBarcode: g.needsBarcode,
        notes: o.notes,
      });
    }
    for (const c of catalogue)
      if (!seen.has(c.sku))
        items.push({
          name: c.name,
          code: c.sku,
          counted: c.expected_quantity,
          detected: 0,
          confidence: 0,
          status: 'partial',
          needsBarcode: false,
          notes: 'ფოტოებზე ვერ ვნახე — შეიძლება კადრში არ მოხვდა.',
        });
    const order = { mismatch: 0, unknown: 1, partial: 2, match: 3 };
    items.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'ka'));
    const result: AiResult = { summary: analysis.summary, quality: analysis.image_quality, items };
    const { error } = await supabase.from('shelf_ai_checks').insert({
      company_id: session.company.id,
      stocktake_id: stocktakeId,
      location_id: locationId,
      result,
      photos: images.length,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
    if (error) return { error: error.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `შემოწმება ვერ შესრულდა: ${msg.slice(0, 200)}` };
  }
  revalidatePath(`/count/${stocktakeId}/${locationId}/done`);
  return {};
}

const MAX_CANDIDATES = 250;

export type PhotoMatch = {
  hits: ProductHit[];
  /** A name read from the package, for the new-product form when nothing fits. */
  guess: string;
  error?: string;
};

/**
 * The barcode won't read: a photo of the product instead. The model reads the
 * package and picks from what is booked on this shelf (then the rest of the
 * stocktake); a name search with what it read covers everything else.
 * The counter always picks — nothing is chosen for them.
 */
export async function identifyByPhoto(
  stocktakeId: string,
  locationId: string,
  photo: string,
): Promise<PhotoMatch> {
  await requireSession();
  if (!process.env.ANTHROPIC_API_KEY)
    return { hits: [], guess: '', error: 'AI-ს გასაღები (ANTHROPIC_API_KEY) Vercel-ში ჯერ არ ჩაწერილა.' };
  const b64 = photo.replace(/^data:image\/jpeg;base64,/, '');
  if (b64.length < 100) return { hits: [], guess: '', error: 'ფოტო ვერ წავიკითხე.' };
  const supabase = await createClient();

  // This shelf's booked products first, then the rest of the stocktake's.
  const { data: book } = await supabase
    .from('stocktake_book')
    .select('product_id, location_id')
    .eq('stocktake_id', stocktakeId)
    .limit(5000);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const pass of [true, false])
    for (const b of book ?? []) {
      const id = b.product_id as string;
      if (!id || seen.has(id) || (b.location_id === locationId) !== pass) continue;
      seen.add(id);
      ids.push(id);
    }
  const pick = ids.slice(0, MAX_CANDIDATES);
  const { data: prods } = pick.length
    ? await supabase
        .from('products')
        .select('id, sku, barcode, name, variant, unit, brand, visual_notes')
        .in('id', pick)
        .eq('active', true)
    : { data: [] };
  const refs = new Map<string, ProductHit>();
  const candidates: Candidate[] = (prods ?? []).map((p, i) => {
    const ref = `P${i + 1}`;
    refs.set(ref, { id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, variant: p.variant, unit: p.unit });
    return { ref, name: p.name, brand: p.brand, variant: p.variant, notes: p.visual_notes };
  });

  try {
    const r = await identifyProduct({
      image: Buffer.from(b64, 'base64'),
      mediaType: 'image/jpeg',
      candidates,
    });
    const hits: ProductHit[] = [];
    const add = (p: ProductHit | undefined) => {
      if (p && !hits.some((h) => h.id === p.id)) hits.push(p);
    };
    for (const m of r.matches) if (m.confidence >= 0.3) add(refs.get(m.ref));
    const digits = r.barcode_digits.replace(/\D/g, '');
    if (digits.length >= 8) for (const p of await findProducts(digits).catch(() => [])) add(p);
    if (hits.length < 3 && r.name_guess.trim())
      for (const p of (await findProducts(r.name_guess).catch(() => [])).slice(0, 5)) add(p);
    return { hits: hits.slice(0, 6), guess: r.name_guess.trim() || r.label_text.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { hits: [], guess: '', error: `ამოცნობა ვერ მოხერხდა: ${msg.slice(0, 200)}` };
  }
}
