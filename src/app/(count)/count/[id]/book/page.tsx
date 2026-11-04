import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import type { Stocktake } from '@/types/database';
import BookImport from './book-import';

export default async function BookPage({ params }: PageProps<'/count/[id]/book'>) {
  const { id } = await params;
  const { profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(`/count/${id}`);
  const supabase = await createClient();
  const { data: stocktake } = await supabase.from('stocktakes').select('*').eq('id', id).maybeSingle<Stocktake>();
  if (!stocktake) notFound();
  const { count } = await supabase.from('stocktake_book').select('id', { count: 'exact', head: true }).eq('stocktake_id', id);

  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/count/${id}`} className="text-sm text-ink-faint">← {stocktake.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">ბუღალტრული ნაშთი</h1>
        <p className="text-sm text-ink-soft">
          {count ? `ახლა ჩატვირთულია ${count} ხაზი. ახალი ფაილი ძველს ჩაანაცვლებს.` : 'ნაშთი ჯერ არ არის ჩატვირთული.'}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          მთვლელები ამ რიცხვებს ვერ ხედავენ. თაროს სვეტი თუ წერია, ზონის დახურვისას სხვაობა მაშინვე გამოჩნდება;
          თუ არა — შედარება ანგარიშში, ბოლოს.
        </p>
      </div>
      <BookImport stocktakeId={id} />
    </div>
  );
}
