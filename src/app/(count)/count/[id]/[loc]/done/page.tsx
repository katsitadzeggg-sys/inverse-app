import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake, StocktakeZone } from '@/types/database';
import ShelfSummaryForm from './summary-form';
import MediaUpload from './media-upload';

/**
 * Shelf summary after closing: one generated statement (who, when, where,
 * which shelf, how many differences remain) plus a free comment, photos and
 * videos of the shelf, then Close or open the next shelf.
 */
export default async function ShelfDonePage({ params }: PageProps<'/count/[id]/[loc]/done'>) {
  const { id, loc } = await params;
  const { userId, profile, company } = await requireSession();
  const supabase = await createClient();

  const [{ data: st }, { data: location }, { data: zone }] = await Promise.all([
    supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>(),
    supabase.from('locations').select('id, code, name').eq('id', loc).maybeSingle<{ id: string; code: string; name: string }>(),
    supabase.from('stocktake_zones').select('*').eq('stocktake_id', id).eq('location_id', loc).maybeSingle<StocktakeZone>(),
  ]);
  if (!st || !location || !zone) notFound();

  const [{ data: counter }, { count: bookLines }, { data: checks }, { data: media }] = await Promise.all([
    supabase.from('user_profiles').select('full_name, email').eq('id', zone.counter_id ?? '').maybeSingle<{ full_name: string | null; email: string }>(),
    supabase.from('stocktake_checks').select('id', { count: 'exact', head: true }).eq('stocktake_id', id).eq('location_id', loc),
    supabase.from('stocktake_checks').select('status').eq('stocktake_id', id).eq('location_id', loc).returns<{ status: string }[]>(),
    supabase.from('stocktake_media').select('id, path, kind').eq('stocktake_id', id).eq('location_id', loc).order('created_at')
      .returns<{ id: string; path: string; kind: 'photo' | 'video' }[]>(),
  ]);

  const differences = (checks ?? []).filter((c) => c.status !== 'ok').length;
  const when = new Date(zone.done_at ?? zone.started_at);
  const result = !bookLines
    ? 'ნაშთთან შედარება არ ჩატარებულა'
    : differences === 0
      ? 'ყველაფერი ზუსტია'
      : `გამოვლინდა ${differences} სხვაობა`;
  const statement =
    `თარო აღწერილია. ${counter?.full_name ?? counter?.email ?? ''}, ${when.toLocaleDateString('ka-GE')} ` +
    `${when.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' })}, ` +
    `${st.client_name ?? st.name}${st.branch ? ` / ${st.branch}` : ''}, თარო ${location.code}. ${result}.`;

  const signed = await Promise.all(
    (media ?? []).map(async (m) => {
      const { data } = await supabase.storage.from('stocktake-media').createSignedUrl(m.path, 60 * 30);
      return { ...m, url: data?.signedUrl ?? '' };
    }),
  );
  const canEdit = zone.counter_id === userId || profile.role === 'owner' || profile.role === 'admin';

  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/count/${id}`} className="text-sm text-ink-faint">← {st.number}</Link>
        <h1 className="mt-1 text-2xl font-semibold">{location.code}</h1>
      </div>

      <div className={`rounded-control border-2 p-4 ${differences ? 'border-mismatch/50' : 'border-match/50'}`}>
        <p className="text-base leading-relaxed">{statement}</p>
      </div>

      {canEdit && (
        <MediaUpload stocktakeId={id} locationId={loc} companyId={company.id} userId={userId} items={signed} />
      )}

      {canEdit ? (
        <ShelfSummaryForm stocktakeId={id} locationId={loc} note={zone.note ?? ''} />
      ) : (
        zone.note && <p className="rounded-control border border-rule/70 p-3">💬 {zone.note}</p>
      )}
    </div>
  );
}
