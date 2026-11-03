import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { EmptyState, ButtonLink } from '@/components/ui';
import type { Location } from '@/types/database';
import CapturePanel from './capture-panel';

export const metadata = { title: 'Verify' };

type LevelRow = { location_id: string };

export default async function VerifyPage() {
  const { canWrite } = await requireSession();
  const supabase = await createClient();

  const [{ data: locations }, { data: levels }] = await Promise.all([
    supabase.from('locations').select('*').order('code').returns<Location[]>(),
    supabase.from('inventory_levels').select('location_id').returns<LevelRow[]>(),
  ]);

  // Only locations with stock on record can be verified against anything.
  const stocked = new Set((levels ?? []).map((level) => level.location_id));
  const verifiable = (locations ?? []).filter((location) => stocked.has(location.id));

  if (!canWrite) {
    return (
      <EmptyState
        title="Read-only access"
        description="Your role can view inventory and past checks but cannot run new verifications. Ask an owner or admin to change your role."
      />
    );
  }

  if (verifiable.length === 0) {
    return (
      <EmptyState
        title="Nothing to verify yet"
        description="A verification compares a photo against the stock recorded at one location. Put at least one product on a shelf first."
        action={<ButtonLink href="/products">Add stock</ButtonLink>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify a shelf</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-faint">
          Point the camera at a shelf, freeze a frame, and Inverse counts what it sees
          against the record for that location. Analysis runs on a still image, not a live
          stream — so hold steady, capture, then send.
        </p>
      </div>
      <CapturePanel locations={verifiable} />
    </div>
  );
}
