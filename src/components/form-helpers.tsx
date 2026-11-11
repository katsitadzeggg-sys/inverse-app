'use client';

import { useEffect } from 'react';

const SKIP = /^(password|email|username|current-password|new-password|one-time-code)$/;

/**
 * Two browser habits the app does not want in its forms:
 * - Chrome's history drop-down of everything ever typed into a field called
 *   "name" (product names from other sites over the input): fields get
 *   autocomplete="off" unless they ask for something on purpose;
 * - the English "Please fill out this field": replaced by Georgian.
 */
export default function FormHelpers() {
  useEffect(() => {
    const mark = (root: ParentNode) =>
      root
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
        .forEach((el) => {
          const want = el.getAttribute('autocomplete');
          if (!want || !SKIP.test(want)) el.setAttribute('autocomplete', 'off');
        });
    mark(document);
    const mo = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach((n) => n instanceof HTMLElement && mark(n));
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const invalid = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (!el.validity) return;
      if (el.validity.valueMissing) el.setCustomValidity('შეავსე ეს ველი');
      else if (el.validity.typeMismatch)
        el.setCustomValidity(el.type === 'email' ? 'ელ-ფოსტა არასწორია' : 'მნიშვნელობა არასწორია');
      else if (el.validity.rangeUnderflow || el.validity.rangeOverflow)
        el.setCustomValidity('რიცხვი დასაშვებ ფარგლებს გარეთაა');
    };
    const clear = (e: Event) => (e.target as HTMLInputElement).setCustomValidity?.('');
    document.addEventListener('invalid', invalid, true);
    document.addEventListener('input', clear, true);
    document.addEventListener('change', clear, true);
    return () => {
      mo.disconnect();
      document.removeEventListener('invalid', invalid, true);
      document.removeEventListener('input', clear, true);
      document.removeEventListener('change', clear, true);
    };
  }, []);
  return null;
}
