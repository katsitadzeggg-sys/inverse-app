import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'მართვა' };

/** The manager module: owners and admins only. Counters are sent to /count. */
export default async function ManageLayout({ children }: LayoutProps<'/'>) {
  const { profile, company } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect('/count');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-rule/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link href="/manage" className="text-base font-semibold tracking-tight">
            Inverse · მართვა
          </Link>
          <Link href="/manage/team" className="text-sm text-ink-soft underline">
            👥 გუნდი
          </Link>
          <Link href="/count" className="text-sm text-ink-soft underline">
            აღმწერის ეკრანი
          </Link>
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
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
