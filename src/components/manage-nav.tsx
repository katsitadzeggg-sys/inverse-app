'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** Tabs of the manager module, in the style of the dashboard. */
export default function ManageNav({ platform }: { platform: boolean }) {
  const pathname = usePathname();
  const kind = useSearchParams().get('kind') ?? 'stock';
  const links = [
    { href: '/manage', label: 'მთავარი', active: pathname === '/manage' },
    { href: '/manage/stocktakes?kind=stock', label: '📦 მარაგები', active: pathname === '/manage/stocktakes' && kind === 'stock' },
    { href: '/manage/stocktakes?kind=expiry', label: '⏳ ვადიანი', active: pathname === '/manage/stocktakes' && kind === 'expiry' },
    { href: '/manage/stocktakes?kind=assets', label: '🏷 ძირ. საშუალებები', active: pathname === '/manage/stocktakes' && kind === 'assets' },
    { href: '/manage/team', label: '👥 გუნდი', active: pathname.startsWith('/manage/team') },
    ...(platform ? [{ href: '/manage/platform', label: '🏢 პლატფორმა', active: pathname.startsWith('/manage/platform') }] : []),
  ];
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.active ? 'page' : undefined}
          className={`whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium transition ${
            l.active ? 'bg-paper-sunk text-ink' : 'text-ink-faint hover:bg-paper-sunk/60 hover:text-ink'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
