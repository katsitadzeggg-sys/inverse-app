'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { LocationKind } from '@/types/database';

export type LocationFormState = { error?: string; notice?: string };

const KINDS: LocationKind[] = ['warehouse', 'shelf', 'store', 'transit', 'other'];

export async function createLocation(
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const session = await requireSession();
  if (!session.canWrite) return { error: 'Your role is read-only.' };

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kindValue = String(formData.get('kind') ?? 'shelf');
  const parentId = String(formData.get('parent_id') ?? '').trim() || null;

  if (!code || !name) return { error: 'Code and name are both required.' };
  const kind = KINDS.includes(kindValue as LocationKind)
    ? (kindValue as LocationKind)
    : 'shelf';

  const supabase = await createClient();
  const { error } = await supabase.from('locations').insert({
    company_id: session.company.id,
    code,
    name,
    kind,
    parent_id: parentId,
  });

  if (error) {
    return {
      error:
        error.code === '23505'
          ? `Location code ${code} is already in use.`
          : error.message,
    };
  }

  revalidatePath('/locations');
  revalidatePath('/products');
  return { notice: `${code} added.` };
}
