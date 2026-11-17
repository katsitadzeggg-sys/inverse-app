'use client';

import { useState } from 'react';

/** A password field with 👁 show / hide. */
export default function PasswordInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'პაროლის დამალვა' : 'პაროლის ჩვენება'}
        title={shown ? 'დამალვა' : 'ჩვენება'}
        className="absolute right-1.5 top-1/2 mt-0.75 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-faint hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}
