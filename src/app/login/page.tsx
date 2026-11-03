import { Suspense } from 'react';
import Link from 'next/link';
import LoginForm from './login-form';
import { isSupabaseConfigured } from '@/lib/env';
import { SITE_URL } from '@/lib/site-url';

export const metadata = { title: 'Sign in' };

/**
 * The bridge between the public site and the platform. It borrows the site's
 * vocabulary — hairline rules, square corners, the display face — so crossing
 * from one to the other does not feel like landing on a different product.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl items-baseline gap-6 px-6 py-5">
          <Link
            href={SITE_URL}
            className="font-display text-lg tracking-[0.08em]"
          >
            INVERSE
          </Link>
          <p className="label">Platform</p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 items-start px-6 py-20">
        <div className="w-full max-w-sm">
          {!isSupabaseConfigured() && (
            <p className="mb-10 border-l-2 border-review pl-4 text-sm text-ink-soft">
              This preview has no database attached, so accounts are unavailable.
            </p>
          )}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
