'use client';

import { useState } from 'react';
import { inputClass } from '@/components/ui';
import { fixDashes, normKey } from '@/lib/text';

/**
 * A text field with its own drop-down below it: the list opens on tap and
 * narrows to what matches as you type (anywhere in the word). Typing a new
 * value is always allowed. Replaces the browser's datalist, which on iPhone
 * only shows three guesses above the keyboard.
 */
export default function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  className = inputClass,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const k = normKey(value);
  const shown = options
    .filter((o) => (o.toLowerCase().includes(q) || (k && normKey(o).includes(k))) && o !== value)
    .slice(0, 50);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(fixDashes(e.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Let a tap on an option land before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} ${options.length ? 'pr-10' : ''}`}
      />
      {options.length > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
        >
          ▾
        </span>
      )}
      {open && shown.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-control border border-rule-strong bg-white py-1 text-black shadow-lg">
          {shown.map((o) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="block w-full px-4 py-3 text-left text-base active:bg-gray-100"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
