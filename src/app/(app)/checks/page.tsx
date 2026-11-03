import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { ButtonLink, Card, CheckBadge, EmptyState } from '@/components/ui';
import type { CheckSummary } from '@/types/database';

export const metadata = { title: 'Checks' };

export default async function ChecksPage() {
  await requireSession();
  const supabase = await createClient();

  const { data: checks } = await supabase
    .from('check_summary')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100)
    .returns<CheckSummary[]>();

  const list = checks ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Verification history</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Every AI check, with the photo it was based on.
          </p>
        </div>
        <ButtonLink href="/verify">New verification</ButtonLink>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="No checks yet"
          description="Run your first verification and it will appear here with its full result breakdown."
          action={<ButtonLink href="/verify">Run a verification</ButtonLink>}
        />
      ) : (
        <Card title="All checks">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-rule/70 text-left text-xs uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">Location</th>
                  <th className="pb-2 pr-4 font-medium">By</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 text-right font-medium">Match</th>
                  <th className="pb-2 pr-4 text-right font-medium">Review</th>
                  <th className="pb-2 text-right font-medium">Mismatch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/50">
                {list.map((check) => (
                  <tr key={check.id} className="transition hover:bg-paper-sunk/40">
                    <td className="py-3 pr-4">
                      <Link href={`/checks/${check.id}`} className="hover:text-ink">
                        {new Date(check.started_at).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-ink-soft">
                        {check.location_code}
                      </span>{' '}
                      {check.location_name}
                    </td>
                    <td className="py-3 pr-4 text-ink-faint">
                      {check.created_by_name ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <CheckBadge status={check.status} />
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-match">
                      {check.match_count}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-review">
                      {check.partial_count}
                    </td>
                    <td className="py-3 text-right tabular-nums text-mismatch">
                      {check.mismatch_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
