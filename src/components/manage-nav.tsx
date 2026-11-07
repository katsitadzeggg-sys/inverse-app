'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Tabs of the manager module, in the style of the dashboard. */
export default function ManageNav({ platform }: { platform: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: '/manage', label: 'მთავარი', active: pathname === '/manage' },
    {
      href: '/manage/stocktakes',
      label: '📋 ინვენტარიზაციები',
      active: pathname === '/manage/stocktakes' || pathname === '/manage/new',
    },
    {
      href: '/manage/sites',
      label: '⚙️ მართვის პანელი',
      active: pathname.startsWith('/manage/sites') || pathname.startsWith('/manage/team'),
    },
    ...(platform
      ? [
          {
            href: '/manage/platform',
            label: '🏢 პლატფორმა',
            active: pathname.startsWith('/manage/platform'),
          },
        ]
      : []),
  ];
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.active ? 'page' : undefined}
          className={`whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium transition ${
            l.active ? 'bg-white/20 text-white' : 'text-white hover:bg-white/10'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
