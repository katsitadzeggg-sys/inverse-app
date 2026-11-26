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
      className="h-12 min-w-[14rem] flex-1 rounded-full border border-rule bg-paper px-4 text-[15px] sm:max-w-md"
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
