import Link from 'next/link';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import ManageNav from '@/components/manage-nav';
import { Bell, ProfileMenu, type Note } from '@/components/manage-topbar';
import FormHelpers from '@/components/form-helpers';

export const metadata = { title: 'მართვა' };

const ROLE: Record<string, string> = { owner: 'მფლობელი', admin: 'მენეჯერი' };

/**
 * The manager module, in a classic admin layout: a sidebar with the menu on
 * top and administration at the bottom left; a top bar with search, the
 * notifications bell and the profile menu (profile, light/dark, sign-out).
 * Owners and admins only.
 */
export default async function ManageLayout({ children }: LayoutProps<'/'>) {
  const { userId, profile, company } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect('/count');
  const supabase = await createClient();
  const [{ data: platformAdmin }, { count: open }, { data: notes }, { data: reads }] =
    await Promise.all([
      supabase.rpc('is_platform_admin'),
      supabase
        .from('stocktakes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('archived_at', null),
      supabase
        .from('app_notifications')
        .select('id, kind, title, body, link, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('app_notification_reads').select('notification_id').eq('user_id', userId),
    ]);
  const read = new Set((reads ?? []).map((r) => r.notification_id as string));
  const list: Note[] = (notes ?? []).map((n) => ({
    ...(n as Omit<Note, 'read'>),
    read: read.has(n.id),
  }));
  const theme = (await cookies()).get('inv_theme')?.value === 'dark' ? 'dark' : 'light';
  const who = profile.full_name ?? profile.email;
  const initials = who
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <div
      data-manage-root
      className={`theme-light ${theme === 'dark' ? 'theme-dark' : ''} min-h-full p-3 lg:p-4`}
    >
      <FormHelpers />
      <div className="mx-auto grid max-w-[1600px] gap-3 lg:grid-cols-[15.5rem_1fr] lg:gap-4">
        <aside className="rounded-2xl bg-paper-sunk p-4 lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)] lg:flex-col">
          <Link href="/manage" className="mb-3 flex items-center gap-2.5 px-2 lg:mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/ring-clear.webp"
              alt=""
              className="brand-ring h-9 w-9 object-contain"
            />
            <span className="text-xl font-semibold tracking-tight">Inverse</span>
          </Link>
          <Suspense>
            <ManageNav platform={!!platformAdmin} open={open ?? 0} />
          </Suspense>
        </aside>

        <div className="grid min-w-0 content-start gap-3 lg:gap-4">
          <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-paper-sunk px-4 py-3">
            <form action="/manage/stocktakes" className="relative min-w-0 flex-1 sm:max-w-sm">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                name="q"
                placeholder="ძებნა: ნომერი, კლიენტი, ფილიალი"
                className="w-full rounded-full border border-rule bg-paper py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <Bell notes={list} />
              <ProfileMenu
                name={who}
                sub={`${company.name} · ${ROLE[profile.role] ?? profile.role}`}
                initials={initials}
                theme={theme}
              />
            </div>
          </header>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
