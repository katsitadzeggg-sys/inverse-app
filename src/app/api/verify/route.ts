import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import {
  analyzeShelfPhoto,
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
} from '@/lib/verification/analyze';
import type { CatalogueEntry } from '@/lib/verification/prompt';
import { grade, type GradedObservation } from '@/lib/verification/grade';
import type { Location, Product } from '@/types/database';

// A vision call over a busy shelf can take well over the default budget.
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type LevelRow = { quantity: number; products: Product | null };

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.canWrite) {
    return NextResponse.json(
      { error: 'Your role is read-only, so you cannot run a verification.' },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get('image');
  const locationId = form.get('location_id');

  if (!(file instanceof File)) return badRequest('No photo was uploaded.');
  if (typeof locationId !== 'string' || !locationId) {
    return badRequest('Pick a location before running a check.');
  }
  if (!isSupportedImageType(file.type)) {
    return badRequest(`Unsupported image type. Use ${SUPPORTED_IMAGE_TYPES.join(', ')}.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return badRequest('That photo is larger than 10 MB. Capture at a lower resolution.');
  }

  const supabase = await createClient();

  const { data: location } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('id', locationId)
    .maybeSingle<Pick<Location, 'id' | 'code' | 'name'>>();

  if (!location) return badRequest('That location does not exist.');

  const { data: levels, error: levelsError } = await supabase
    .from('inventory_levels')
    .select('quantity, products (*)')
    .eq('location_id', location.id)
    .returns<LevelRow[]>();

  if (levelsError) {
    return NextResponse.json({ error: levelsError.message }, { status: 500 });
  }

  const stocked = (levels ?? []).filter(
    (row): row is LevelRow & { products: Product } => row.products !== null && row.products.active,
  );

  if (stocked.length === 0) {
    return badRequest(
      'This location has no products on record yet, so there is nothing to verify against.',
    );
  }

  const catalogue: CatalogueEntry[] = stocked.map(({ quantity, products }) => ({
    sku: products.sku,
    name: products.name,
    brand: products.brand,
    variant: products.variant,
    barcode: products.barcode,
    visual_notes: products.visual_notes,
    unit: products.unit,
    expected_quantity: quantity,
  }));

  const bySku = new Map(stocked.map((row) => [row.products.sku, row]));

  const checkId = crypto.randomUUID();
  const imagePath = `${session.company.id}/${checkId}.${EXTENSIONS[file.type]}`;

  const { error: uploadError } = await supabase.storage
    .from('inventory-checks')
    .upload(imagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: `Could not store the photo: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { error: insertError } = await supabase.from('inventory_checks').insert({
    id: checkId,
    company_id: session.company.id,
    location_id: location.id,
    created_by: session.userId,
    status: 'analyzing',
    image_path: imagePath,
  });

  if (insertError) {
    await supabase.storage.from('inventory-checks').remove([imagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  try {
    const { analysis, model, inputTokens, outputTokens } = await analyzeShelfPhoto({
      image: Buffer.from(await file.arrayBuffer()),
      mediaType: file.type,
      location: { code: location.code, name: location.name },
      catalogue,
    });

    const seen = new Set<string>();
    const graded: (GradedObservation & { productId: string | null; label: string })[] = [];

    for (const observation of analysis.observations) {
      const row = bySku.get(observation.sku);
      seen.add(observation.sku);
      graded.push({
        ...grade(observation, row ? row.quantity : null),
        productId: row?.products.id ?? null,
        label: row
          ? [row.products.brand, row.products.name].filter(Boolean).join(' ')
          : observation.notes.slice(0, 120) || 'Unrecognised item',
      });
    }

    // A product the model never mentioned is still part of the record: report it
    // as unverified rather than letting it silently drop off the check.
    for (const { quantity, products } of stocked) {
      if (seen.has(products.sku)) continue;
      graded.push({
        sku: products.sku,
        expected: quantity,
        detected: 0,
        confidence: 0,
        status: 'partial',
        needsBarcode: false,
        notes: 'Not mentioned in the analysis — re-shoot this part of the shelf.',
        productId: products.id,
        label: [products.brand, products.name].filter(Boolean).join(' '),
      });
    }

    const { error: itemsError } = await supabase.from('inventory_check_items').insert(
      graded.map((item) => ({
        company_id: session.company.id,
        check_id: checkId,
        product_id: item.productId,
        product_label: item.label,
        expected_qty: item.expected,
        detected_qty: item.detected,
        confidence: item.confidence,
        status: item.status,
        needs_barcode: item.needsBarcode,
        notes: item.notes || null,
      })),
    );

    if (itemsError) throw new Error(itemsError.message);

    await supabase
      .from('inventory_checks')
      .update({
        status: 'completed',
        model,
        summary:
          analysis.image_quality === 'poor'
            ? `${analysis.summary} (Image quality was poor — treat these counts as provisional.)`
            : analysis.summary,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        completed_at: new Date().toISOString(),
      })
      .eq('id', checkId);

    return NextResponse.json({ id: checkId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    await supabase
      .from('inventory_checks')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', checkId);

    return NextResponse.json({ error: message, id: checkId }, { status: 502 });
  }
}
