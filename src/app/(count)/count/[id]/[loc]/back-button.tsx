'use client';

import { useRouter } from 'next/navigation';

/**
 * "← Back" on the shelf page. It steps back one state on the screen first:
 * an open product is closed, then the products saved one by one are opened
 * again (newest first) to correct them. Only when there is nothing left to
 * step back through does it go to the shelf list.
 */
export default function BackButton({ href }: { href: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        const ask = new CustomEvent('count-back', { detail: { handled: false } });
        window.dispatchEvent(ask);
        if (!ask.detail.handled) router.push(href);
      }}
      className="inline-flex w-fit items-center gap-2 rounded-control border border-rule-strong px-4 py-2 text-base font-medium text-ink"
    >
      ← დაბრუნება
    </button>
  );
}
