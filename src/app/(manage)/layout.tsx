import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import ManageNav from '@/components/manage-nav';

export const metadata = { title: 'მართვა' };

const ROLE: Record<string, string> = { owner: 'მფლობელი', admin: 'მენეჯერი' };

/** The manager module: owners and admins only. Counters are sent to /count. */
export default async function ManageLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect('/count');
  const { data: platformAdmin } = await (await createClient()).rpc('is_platform_admin');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-rule/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          {/* Inverse's spinning ring (2 × 2 cm), colour cycling through the three apps. */}
          <Link href="/manage" aria-label="მთავარი" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/ring.webp"
              alt=""
              className="brand-ring h-[2cm] w-[2cm] object-contain"
            />
          </Link>
          <Suspense>
            <ManageNav platform={!!platformAdmin} />
          </Suspense>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{company.name}</p>
              <p className="text-xs leading-tight text-ink-faint">
                {profile.full_name ?? profile.email} · {ROLE[profile.role] ?? profile.role}
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-control border border-rule-strong px-3 py-1.5 text-sm text-ink-soft transition hover:border-ink-faint hover:text-ink"
              >
                გასვლა
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
