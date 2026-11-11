import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import ManageNav from '@/components/manage-nav';

export const metadata = { title: 'მართვა' };

const ROLE: Record<string, string> = { owner: 'მფლობელი', admin: 'მენეჯერი' };

/**
 * The manager module, in a classic light admin layout: a white sidebar with
 * the menu on the left, a top bar with search and the user, and the page on a
 * pale grey ground in white rounded cards. Owners and admins only.
 */
export default async function ManageLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect('/count');
  const supabase = await createClient();
  const [{ data: platformAdmin }, { count: open }] = await Promise.all([
    supabase.rpc('is_platform_admin'),
    supabase
      .from('stocktakes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .is('archived_at', null),
  ]);
  const who = profile.full_name ?? profile.email;
  const initials = who
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <div className="theme-light min-h-full p-3 lg:p-4">
      <div className="mx-auto grid max-w-[1600px] gap-3 lg:grid-cols-[15.5rem_1fr] lg:gap-4">
        {/* Sidebar */}
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
          <div className="mt-auto hidden rounded-2xl bg-gradient-to-br from-[#0f3d26] via-[#155c39] to-[#0b2e1d] p-4 text-white lg:block">
            <p className="text-lg font-semibold leading-snug">დათვლა ტელეფონით</p>
            <p className="mt-1 text-xs text-white/70">სკანერი, ფოტო და თაროები — აღწერის აპში.</p>
            <Link
              href="/count"
              className="mt-4 block rounded-full bg-[#1f7a4d] px-3 py-2 text-center text-sm font-semibold hover:bg-[#25915c]"
            >
              გახსნა
            </Link>
          </div>
        </aside>

        <div className="grid min-w-0 content-start gap-3 lg:gap-4">
          {/* Top bar */}
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
            <div className="ml-auto flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#dcefe4] text-sm font-semibold text-[#155c39]">
                {initials}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">{who}</p>
                <p className="text-xs text-ink-faint">
                  {company.name} · {ROLE[profile.role] ?? profile.role}
                </p>
              </div>
              <form action="/auth/signout" method="post" className="lg:hidden">
                <button
                  type="submit"
                  className="rounded-full border border-rule-strong px-3 py-1.5 text-sm"
                >
                  გასვლა
                </button>
              </form>
            </div>
          </header>
          <main className="min-w-0 rounded-2xl bg-paper-sunk/0">{children}</main>
        </div>
      </div>
    </div>
  );
}
