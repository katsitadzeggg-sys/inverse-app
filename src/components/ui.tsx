import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { CheckStatus, MatchStatus } from '@/types/database';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-control border border-rule/70 bg-paper-sunk/60 shadow-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-rule/70 px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'match' | 'partial' | 'mismatch';
}) {
  const toneClass = {
    default: 'text-ink',
    match: 'text-match',
    partial: 'text-review',
    mismatch: 'text-mismatch',
  }[tone];

  return (
    <div className="rounded-control border border-rule/70 bg-paper-sunk/60 px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

const MATCH_LABELS: Record<MatchStatus, { label: string; className: string }> = {
  match: { label: 'Match', className: 'bg-match/15 text-match ring-match/30' },
  partial: { label: 'Check', className: 'bg-review/15 text-review ring-review/30' },
  mismatch: {
    label: 'Mismatch',
    className: 'bg-mismatch/15 text-mismatch ring-mismatch/30',
  },
  unknown: { label: 'Unlisted', className: 'bg-rule-strong/30 text-ink-soft ring-rule-strong/50' },
};

export function MatchBadge({ status }: { status: MatchStatus }) {
  const { label, className } = MATCH_LABELS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}

const CHECK_LABELS: Record<CheckStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-rule-strong/30 text-ink-soft ring-rule-strong/50' },
  analyzing: {
    label: 'Analyzing',
    className: 'bg-ink/15 text-ink ring-ink/30',
  },
  completed: { label: 'Completed', className: 'bg-match/15 text-match ring-match/30' },
  failed: { label: 'Failed', className: 'bg-mismatch/15 text-mismatch ring-mismatch/30' },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const { label, className } = CHECK_LABELS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-ink',
  secondary: 'border border-rule-strong bg-paper-sunk text-ink hover:border-ink-faint',
  ghost: 'text-ink-soft hover:bg-paper-sunk hover:text-ink',
  danger: 'border border-mismatch/40 text-mismatch hover:bg-mismatch/10',
} as const;

type Variant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link {...props} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} />
  );
}

export const inputClass =
  'w-full rounded-control border border-rule-strong bg-paper-sunk px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-control border border-dashed border-rule-strong px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-faint">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  const className =
    tone === 'error'
      ? 'border-mismatch/40 bg-mismatch/10 text-mismatch'
      : 'border-ink/40 bg-ink/10 text-ink';
  return (
    <div className={`rounded-control border px-4 py-3 text-sm ${className}`} role="alert">
      {children}
    </div>
  );
}
