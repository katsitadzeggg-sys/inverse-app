'use client';

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print rounded-control bg-ink px-4 py-3 text-base font-semibold text-paper">
      🖨 დაბეჭდვა
    </button>
  );
}
