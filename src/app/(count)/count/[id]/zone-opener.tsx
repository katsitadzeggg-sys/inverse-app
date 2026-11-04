'use client';

import { useActionState, useRef } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import Scanner from '../scanner';
import { openZone, type FormState } from '../actions';

const EMPTY: FormState = {};

/** Step 1 of counting: scan or type the shelf code to claim that zone. */
export default function ZoneOpener({ stocktakeId }: { stocktakeId: string }) {
  const [state, action, pending] = useActionState(openZone.bind(null, stocktakeId), EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-base font-semibold">1. დაასკანერე თაროს კოდი</p>
      <Scanner
        label="თაროს სკანირება"
        onCode={(code) => {
          if (inputRef.current) inputRef.current.value = code;
          formRef.current?.requestSubmit();
        }}
      />
      <form ref={formRef} action={action} className="flex gap-2">
        <input
          ref={inputRef}
          name="code"
          required
          autoCapitalize="characters"
          placeholder="ან ჩაწერე, მაგ. A-01"
          className={`${inputClass} text-base`}
        />
        <Button type="submit" disabled={pending}>
          {pending ? '…' : 'გახსნა'}
        </Button>
      </form>
      {state.error && <Alert>{state.error}</Alert>}
    </section>
  );
}
