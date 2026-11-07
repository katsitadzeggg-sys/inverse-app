import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import NewStocktakeForm from '../new-stocktake-form';

export const metadata = { title: 'ახალი ინვენტარიზაცია' };

/** The manager opens a stocktake: module, date, warehouse / object, address. */
export default async function NewStocktake({ searchParams }: PageProps<'/manage/new'>) {
  const { company } = await requireSession();
  const sp = await searchParams;
  const kind =
    typeof sp.kind === 'string' && ['stock', 'expiry', 'assets'].includes(sp.kind)
      ? sp.kind
      : 'stock';
  const supabase = await createClient();
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, address, lat, lng')
    .order('name')
    .returns<
      { id: string; name: string; address: string | null; lat: number | null; lng: number | null }[]
    >();

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <Link
        href="/manage"
        className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium"
      >
        ← დაბრუნება
      </Link>
      <NewStocktakeForm kind={kind} companyName={company.name} sites={sites ?? []} />
    </div>
  );
}
