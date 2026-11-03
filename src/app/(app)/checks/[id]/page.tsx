import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { Alert, Button, Card, CheckBadge, MatchBadge, Stat } from '@/components/ui';
import type { CheckSummary, InventoryCheck, InventoryCheckItem } from '@/types/database';
import { applyCounts } from './actions';

type CheckRow = InventoryCheck & { locations: { code: string; name: string } | null };

export default async function CheckDetailPage({ params }: PageProps<'/checks/[id]'>) {
  const { id } = await params;
  const { canWrite } = await requireSession();
  const supabase = await createClient();

  const { data: check } = await supabase
    .from('inventory_checks')
    .select('*, locations (code, name)')
    .eq('id', id)
    .maybeSingle<CheckRow>();

  if (!check) notFound();

  const [{ data: items }, { data: summary }, { data: signed }] = await Promise.all([
    supabase
      .from('inventory_check_items')
      .select('*')
      .eq('check_id', id)
      .order('status')
      .returns<InventoryCheckItem[]>(),
    supabase
      .from('check_summary')
      .select('*')
      .eq('id', id)
      .maybeSingle<CheckSummary>(),
    // The bucket is private; hand the browser a short-lived signed URL instead.
    supabase.storage.from('inventory-checks').createSignedUrl(check.image_path, 60 * 10),
  ]);

  const rows = items ?? [];
  const applicable = rows.filter(
    (row) =>
      row.product_id !== null &&
      !row.needs_barcode &&
      (row.status === 'match' || row.status === 'mismatch'),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/checks" className="text-xs text-ink hover:text-ink">
            ← All checks
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {check.locations?.code} — {check.locations?.name}
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            {new Date(check.started_at).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {check.model && ` · ${check.model}`}
          </p>
        </div>
        <CheckBadge status={check.status} />
      </div>

      {check.status === 'failed' && (
        <Alert>{check.error ?? 'This check failed before it produced a result.'}</Alert>
      )}

      {check.summary && (
        <Card title="What the model saw">
          <p className="text-sm leading-relaxed text-ink-soft">{check.summary}</p>
        </Card>
      )}

      {summary && check.status === 'completed' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Matched" value={summary.match_count} tone="match" />
          <Stat
            label="Needs review"
            value={summary.partial_count}
            tone={summary.partial_count > 0 ? 'partial' : 'default'}
          />
          <Stat
            label="Mismatched"
            value={summary.mismatch_count}
            tone={summary.mismatch_count > 0 ? 'mismatch' : 'default'}
          />
          <Stat
            label="Needs barcode"
            value={summary.needs_barcode_count}
            hint="Look-alike variants vision cannot separate"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          title="Results"
          action={
            canWrite && applicable.length > 0 ? (
              <form action={applyCounts}>
                <input type="hidden" name="check_id" value={check.id} />
                <Button type="submit" variant="secondary" className="px-3 py-1 text-xs">
                  Apply {applicable.length} counts to stock
                </Button>
              </form>
            ) : undefined
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-ink-faint">This check produced no line items.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-rule/70 text-left text-xs uppercase tracking-wider text-ink-faint">
                    <th className="pb-2 pr-4 font-medium">Product</th>
                    <th className="pb-2 pr-4 text-right font-medium">Expected</th>
                    <th className="pb-2 pr-4 text-right font-medium">Counted</th>
                    <th className="pb-2 pr-4 text-right font-medium">Confidence</th>
                    <th className="pb-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/50">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{row.product_label}</p>
                        {row.notes && (
                          <p className="mt-0.5 text-xs text-ink-faint">{row.notes}</p>
                        )}
                        {row.needs_barcode && (
                          <p className="mt-0.5 text-xs text-review">
                            Scan the barcode to confirm which variant this is.
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-ink-soft">
                        {row.expected_qty ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                        {row.detected_qty ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-ink-faint">
                        {row.confidence === null
                          ? '—'
                          : `${Math.round(row.confidence * 100)}%`}
                      </td>
                      <td className="py-3">
                        <MatchBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Photo">
          {signed?.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signed.signedUrl}
              alt={`Shelf ${check.locations?.code ?? ''}`}
              className="w-full rounded-control border border-rule"
            />
          ) : (
            <p className="text-sm text-ink-faint">
              The photo is no longer available in storage.
            </p>
          )}
          {check.input_tokens !== null && (
            <p className="mt-3 text-xs text-ink-faint">
              {check.input_tokens.toLocaleString()} input ·{' '}
              {(check.output_tokens ?? 0).toLocaleString()} output tokens
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
