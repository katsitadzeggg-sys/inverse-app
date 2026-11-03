'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type ProductFormState = { error?: string; notice?: string };

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  return value === '' ? null : value;
}

export async function createProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'Your role is read-only.' };

  const sku = text(formData, 'sku');
  const name = text(formData, 'name');
  if (!sku || !name) return { error: 'SKU and name are both required.' };

  const reorderPoint = Number(formData.get('reorder_point') ?? 0);
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
    return { error: 'Reorder point must be a whole number of 0 or more.' };
  }

  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      company_id: session.company.id,
      sku,
      name,
      brand: text(formData, 'brand'),
      variant: text(formData, 'variant'),
      barcode: text(formData, 'barcode'),
      visual_notes: text(formData, 'visual_notes'),
      unit: text(formData, 'unit') ?? 'pcs',
      reorder_point: reorderPoint,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) {
    return {
      error:
        error.code === '23505'
          ? `SKU ${sku} already exists in this workspace.`
          : error.message,
    };
  }

  // Optional opening stock, so a new product is immediately verifiable.
  const locationId = text(formData, 'location_id');
  const quantity = Number(formData.get('quantity') ?? 0);
  if (locationId && Number.isInteger(quantity)) {
    const { error: levelError } = await supabase.from('inventory_levels').insert({
      company_id: session.company.id,
      product_id: product.id,
      location_id: locationId,
      quantity,
      counted_at: new Date().toISOString(),
    });
    if (levelError) {
      return { error: `Product saved, but its opening stock failed: ${levelError.message}` };
    }
  }

  revalidatePath('/products');
  revalidatePath('/dashboard');
  return { notice: `${name} added.` };
}

export async function setStockLevel(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session.canWrite) return;

  const productId = String(formData.get('product_id') ?? '');
  const locationId = String(formData.get('location_id') ?? '');
  const quantity = Number(formData.get('quantity') ?? 0);

  if (!productId || !locationId || !Number.isInteger(quantity) || quantity < 0) return;

  const supabase = await createClient();
  await supabase.from('inventory_levels').upsert(
    {
      company_id: session.company.id,
      product_id: productId,
      location_id: locationId,
      quantity,
      counted_at: new Date().toISOString(),
    },
    { onConflict: 'product_id,location_id' },
  );

  revalidatePath('/products');
  revalidatePath('/dashboard');
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session.canWrite) return;

  const productId = String(formData.get('product_id') ?? '');
  if (!productId) return;

  const supabase = await createClient();
  // Soft delete: verification history references the product and should survive.
  await supabase.from('products').update({ active: false }).eq('id', productId);

  revalidatePath('/products');
  revalidatePath('/dashboard');
}
