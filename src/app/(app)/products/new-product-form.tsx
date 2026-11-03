'use client';

import { useActionState, useRef } from 'react';
import type { Location } from '@/types/database';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { createProduct, type ProductFormState } from './actions';

const EMPTY: ProductFormState = {};

export default function NewProductForm({ locations }: { locations: Location[] }) {
  const [state, action, pending] = useActionState(createProduct, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <details className="rounded-control border border-rule/70 bg-paper-sunk/60">
      <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-semibold text-ink marker:content-none">
        <span className="text-ink">+</span> Add a product
      </summary>
      <form
        ref={formRef}
        action={async (formData) => {
          await action(formData);
          formRef.current?.reset();
        }}
        className="grid gap-4 border-t border-rule/70 p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field label="SKU">
          <input name="sku" required placeholder="JAN-1362" className={inputClass} />
        </Field>
        <Field label="Name">
          <input name="name" required placeholder="Hairbrush 1362" className={inputClass} />
        </Field>
        <Field label="Brand">
          <input name="brand" placeholder="Janeke" className={inputClass} />
        </Field>
        <Field label="Variant">
          <input name="variant" placeholder="Large" className={inputClass} />
        </Field>
        <Field label="Barcode" hint="Needed to separate look-alike variants.">
          <input name="barcode" placeholder="8006060139621" className={inputClass} />
        </Field>
        <Field label="Unit">
          <input name="unit" defaultValue="pcs" className={inputClass} />
        </Field>
        <Field label="Reorder point">
          <input
            name="reorder_point"
            type="number"
            min={0}
            defaultValue={0}
            className={inputClass}
          />
        </Field>
        <Field label="Opening location">
          <select name="location_id" className={inputClass} defaultValue="">
            <option value="">None</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Opening quantity">
          <input name="quantity" type="number" min={0} defaultValue={0} className={inputClass} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field
            label="Visual notes"
            hint="How this looks on a shelf. The vision model reads this to tell near-identical variants apart."
          >
            <textarea
              name="visual_notes"
              rows={2}
              placeholder="Matte black handle, gold logo band, same silhouette as JAN-1363"
              className={inputClass}
            />
          </Field>
        </div>

        {state.error && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.notice && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Alert tone="info">{state.notice}</Alert>
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Add product'}
          </Button>
        </div>
      </form>
    </details>
  );
}
