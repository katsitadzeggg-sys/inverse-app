import Link from 'next/link';
import { requireSession } from '@/lib/session';
import AppNav from '@/components/app-nav';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-rule/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-tight">Inverse</span>
          </Link>
          <AppNav />
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{company.name}</p>
              <p className="text-xs leading-tight text-ink-faint">
                {profile.full_name ?? profile.email} · {profile.role}
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-control border border-rule-strong px-3 py-1.5 text-sm text-ink-soft transition hover:border-ink-faint hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
