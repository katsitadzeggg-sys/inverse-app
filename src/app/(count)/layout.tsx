import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import OutboxStatus from '@/components/outbox-status';
import SwRegister from '@/components/sw-register';

export const metadata = { title: 'დათვლა' };

export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#0f172a' };

/** The counter's phone screen: one column, big targets, Georgian only. */
export default async function CountLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';
  // Which counter app: fixed assets (/count, green) or stock (/stock, orange).
  const app = (await cookies()).get('inv_app')?.value === 'stock' ? 'stock' : 'assets';
  const home = app === 'stock' ? '/stock' : '/count';

  return (
    <div data-app={app} className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-10 border-b border-rule/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {manager ? (
            <Link href="/manage" className="rounded-control border border-rule-strong bg-paper-sunk px-2.5 py-1.5 text-sm font-semibold">
            🏠 მთავარი
          </Link>
          ) : (
            <Link href={home} className="rounded-control border border-rule-strong bg-paper-sunk px-2.5 py-1.5 text-sm font-semibold">
              {app === 'stock' ? '📦 მარაგები' : '🏷 ძირ. საშუალებები'}
            </Link>
          )}
          <div className="ml-auto text-right">
            <p className="text-sm font-medium leading-tight">{profile.full_name ?? profile.email}</p>
            <p className="text-xs leading-tight text-ink-faint">{company.name}</p>
          </div>

          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-control border border-rule-strong px-2.5 py-1.5 text-xs" title="გასვლა">
              გასვლა
            </button>
          </form>
        </div>
        <OutboxStatus />
        <SwRegister />
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
