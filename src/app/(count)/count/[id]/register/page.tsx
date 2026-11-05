import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import RegisterImport from './register-import';

/** Fixed assets: the manager loads the register the count is checked against. */
export default async function RegisterPage({ params }: PageProps<'/count/[id]/register'>) {
  const { id } = await params;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: stocktake } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  const { count } = await supabase.from('asset_register').select('id', { count: 'exact', head: true }).eq('stocktake_id', id);

  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/manage/${id}`} className="text-sm text-ink-faint">← {stocktake.number}</Link>
        <h1 className="mt-1 text-xl font-semibold">ძირითადი საშუალებების რეესტრი</h1>
        <p className="text-sm text-ink-soft">
          {count ? `ახლა ჩატვირთულია ${count} პოზიცია. ახალი ფაილი ძველს ჩაანაცვლებს.` : 'რეესტრი ჯერ არ არის ჩატვირთული.'}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          აღმწერი ეტიკეტს ასკანერებს და ხედავს დასახელებას და ოთახს. რაც რეესტრშია და არავინ დაასკანერა, დაკარგულში
          გავა; რაც დაასკანერეს და რეესტრში არ არის, მეტობაში.
        </p>
      </div>
      <RegisterImport stocktakeId={id} />
    </div>
  );
}
