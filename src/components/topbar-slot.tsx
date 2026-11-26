'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Puts a page's own controls into the top bar (next to the bell and profile). */
export default function TopbarSlot({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setEl(document.getElementById('topbar-slot')), 0);
    return () => clearTimeout(t);
  }, []);
  return el ? createPortal(children, el) : null;
}
