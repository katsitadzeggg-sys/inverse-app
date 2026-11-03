'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, Field, inputClass } from '@/components/ui';
import { loadDemoData, renameCompany, type SettingsState } from './actions';

const EMPTY: SettingsState = {};

export default function SettingsForms({
  companyName,
  canAdmin,
}: {
  companyName: string;
  canAdmin: boolean;
}) {
  const [renameState, renameAction, renaming] = useActionState(renameCompany, EMPTY);
  const [demoState, demoAction, seeding] = useActionState(loadDemoData, EMPTY);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Workspace">
        <form action={renameAction} className="space-y-4">
          <Field label="Company name">
            <input
              name="name"
              defaultValue={companyName}
              disabled={!canAdmin}
              className={inputClass}
            />
          </Field>
          {renameState.error && <Alert>{renameState.error}</Alert>}
          {renameState.notice && <Alert tone="info">{renameState.notice}</Alert>}
          <Button type="submit" disabled={!canAdmin || renaming}>
            {renaming ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Card>

      <Card title="Demo data">
        <p className="text-sm text-ink-faint">
          Loads a small catalogue — two near-identical hairbrush lines and a cosmetics
          shelf — so you can try the verification flow before importing anything real.
          It refuses to run if the workspace already has products.
        </p>
        <form action={demoAction} className="mt-4 space-y-4">
          {demoState.error && <Alert>{demoState.error}</Alert>}
          {demoState.notice && <Alert tone="info">{demoState.notice}</Alert>}
          <Button type="submit" variant="secondary" disabled={seeding}>
            {seeding ? 'Loading…' : 'Load demo catalogue'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
