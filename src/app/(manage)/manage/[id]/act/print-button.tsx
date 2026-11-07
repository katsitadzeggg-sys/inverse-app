'use client';

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-control bg-match px-5 py-3 text-base font-semibold text-white"
    >
      🖨 ბეჭდვა / PDF
    </button>
  );
}
