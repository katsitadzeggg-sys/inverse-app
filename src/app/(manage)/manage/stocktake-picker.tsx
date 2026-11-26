'use client';

import { useRouter } from 'next/navigation';

/** Which open stocktake the dashboard shows; switches on choosing. */
export default function StocktakePicker({
  current,
  options,
}: {
  current?: string;
  options: { id: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <select
      defaultValue={current}
      onChange={(e) => router.push(`/manage?st=${e.target.value}`)}
      className="rounded-full border border-rule bg-paper px-3 py-2 text-sm"
      aria-label="რომელი ინვენტარიზაცია ჩანს დეშბორდზე"
      title="რომელი ინვენტარიზაცია ჩანს დეშბორდზე"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
