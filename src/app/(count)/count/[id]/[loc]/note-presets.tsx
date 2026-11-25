'use client';

/** Common notes for a new product, one tap each (Giorgi, 25.11). */
export const NEW_PRODUCT_NOTES = [
  'სხვა კოდით არის ბაზაში',
  'შტრიხკოდი არ იკითხება',
  'ეტიკეტი არ აქვს',
  'დაზიანებული',
  'ვადაგასული',
  'ღია შეფუთვა',
];

/** Common notes when closing a shelf. */
export const SHELF_NOTES = [
  'თარო სრულად დათვლილია',
  'ნაწილს ვერ მივწვდი',
  'ზოგი პროდუქტი სხვა თაროზეა',
  'დაზიანებული საქონელი',
  'ვადაგასული საქონელი',
  'თარო ცარიელია',
];

/**
 * Ready-made notes as chips above a comment field: a tap adds the note (or
 * takes it out again); the field stays free to type in.
 */
export default function NotePresets({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const parts = value
    .split(/\s*;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const toggle = (o: string) => {
    const next = parts.includes(o) ? parts.filter((p) => p !== o) : [...parts, o];
    onChange(next.join('; '));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = parts.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-match bg-match/10 text-match' : 'border-rule-strong text-ink-soft'}`}
          >
            {on ? '✓ ' : ''}
            {o}
          </button>
        );
      })}
    </div>
  );
}
