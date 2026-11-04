import Link from 'next/link';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'დათვლა' };

export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#ffffff' };

/** The counter's phone screen: one column, big targets, Georgian only. */
export default async function CountLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-rule/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Link href="/count" className="text-base font-semibold tracking-tight">
            Inverse · დათვლა
          </Link>
          <div className="ml-auto text-right">
            <p className="text-sm font-medium leading-tight">{profile.full_name ?? profile.email}</p>
            <p className="text-xs leading-tight text-ink-faint">{company.name}</p>
          </div>
          {manager && (
            <Link href="/manage" className="text-sm text-ink-soft underline">
              მართვა
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
