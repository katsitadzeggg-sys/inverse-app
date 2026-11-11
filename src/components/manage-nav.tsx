'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Thin line icons, 20 px, drawn in currentColor. */
const I = {
  grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  users: (
    <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75" />
  ),
  building: (
    <path d="M4 21V5l8-3v19M12 8h8v13M4 21h16M8 7h.01M8 11h.01M8 15h.01M16 12h.01M16 16h.01" />
  ),
  phone: (
    <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" />
  ),
};
export function Icon({ name }: { name: keyof typeof I }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {I[name]}
    </svg>
  );
}

type Item = {
  href: string;
  label: string;
  icon: keyof typeof I;
  active: boolean;
  badge?: ReactNode;
};

/**
 * The manager module's menu: a left sidebar on a wide screen, a scrolling row
 * of tabs on a phone. The active item carries a green bar on its left.
 */
export default function ManageNav({ platform, open }: { platform: boolean; open: number }) {
  const pathname = usePathname();
  const menu: Item[] = [
    { href: '/manage', label: 'დეშბორდი', icon: 'grid', active: pathname === '/manage' },
    {
      href: '/manage/stocktakes',
      label: 'ინვენტარიზაციები',
      icon: 'list',
      // A new stocktake is made from here (the "+" button), so it lights this item.
      active:
        pathname === '/manage/stocktakes' ||
        pathname === '/manage/new' ||
        /^\/manage\/[0-9a-f-]{36}/.test(pathname),
      badge: open > 0 ? open : undefined,
    },
    {
      href: '/manage/sites',
      label: 'ობიექტები',
      icon: 'box',
      active: pathname.startsWith('/manage/sites'),
    },
  ];
  // Administration: people, their roles, the platform — at the bottom left.
  const admin: Item[] = [
    {
      href: '/manage/team',
      label: 'გუნდი და როლები',
      icon: 'users',
      active: pathname.startsWith('/manage/team') || pathname.startsWith('/manage/users'),
    },
    ...(platform
      ? [
          {
            href: '/manage/platform',
            label: 'პლატფორმა',
            icon: 'building' as const,
            active: pathname.startsWith('/manage/platform'),
          },
        ]
      : []),
  ];
  const link = (l: Item) => (
    <Link
      key={l.href}
      href={l.href}
      aria-current={l.active ? 'page' : undefined}
      className={`relative flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[15px] transition ${
        l.active ? 'font-semibold text-ink' : 'text-ink-faint hover:bg-paper hover:text-ink'
      }`}
    >
      {l.active && (
        <span className="absolute -left-4 top-1/2 hidden h-7 w-1.5 -translate-y-1/2 rounded-r-full bg-accent lg:block" />
      )}
      <span className={l.active ? 'text-accent' : ''}>
        <Icon name={l.icon} />
      </span>
      <span className="flex-1">{l.label}</span>
      {l.badge != null && (
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {l.badge}
        </span>
      )}
    </Link>
  );
  const heading = (t: string) => (
    <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-ink-faint">{t}</p>
  );
  return (
    <>
      {/* Phone / tablet: one row of tabs. */}
      <nav className="flex gap-1 overflow-x-auto lg:hidden">{[...menu, ...admin].map(link)}</nav>
      {/* Desktop sidebar: the menu on top, administration at the bottom. */}
      <nav className="hidden lg:grid lg:gap-1">
        {heading('მენიუ')}
        {menu.map(link)}
      </nav>
      <nav className="mt-auto hidden border-t border-rule pt-4 lg:grid lg:gap-1">
        {heading('ადმინისტრაცია')}
        {admin.map(link)}
      </nav>
    </>
  );
}
