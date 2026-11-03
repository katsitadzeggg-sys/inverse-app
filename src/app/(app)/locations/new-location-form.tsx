'use client';

import { useActionState, useRef } from 'react';
import type { Location } from '@/types/database';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { createLocation, type LocationFormState } from './actions';

const EMPTY: LocationFormState = {};

export default function NewLocationForm({ locations }: { locations: Location[] }) {
  const [state, action, pending] = useActionState(createLocation, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <details className="rounded-control border border-rule/70 bg-paper-sunk/60">
      <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-semibold marker:content-none">
        <span className="text-ink">+</span> Add a location
      </summary>
      <form
        ref={formRef}
        action={async (formData) => {
          await action(formData);
          formRef.current?.reset();
        }}
        className="grid gap-4 border-t border-rule/70 p-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Code">
          <input name="code" required placeholder="R-2" className={inputClass} />
        </Field>
        <Field label="Name">
          <input
            name="name"
            required
            placeholder="Rack 2 — cosmetics"
            className={inputClass}
          />
        </Field>
        <Field label="Type">
          <select name="kind" defaultValue="shelf" className={inputClass}>
            <option value="warehouse">Warehouse</option>
            <option value="shelf">Shelf</option>
            <option value="store">Store</option>
            <option value="transit">Transit</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Inside">
          <select name="parent_id" defaultValue="" className={inputClass}>
            <option value="">Top level</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
              </option>
            ))}
          </select>
        </Field>

        {state.error && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.notice && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert tone="info">{state.notice}</Alert>
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Add location'}
          </Button>
        </div>
      </form>
    </details>
  );
}
