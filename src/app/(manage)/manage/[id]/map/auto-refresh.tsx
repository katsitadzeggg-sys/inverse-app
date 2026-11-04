'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Reloads the map data every 30 seconds while the page is open. */
export default function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [router]);
  return null;
}
