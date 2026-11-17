/** Shown at once while a manager page loads its data. */
export default function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center rounded-2xl bg-paper-sunk">
      <div className="flex items-center gap-3 text-sm text-ink-faint">
        <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-rule border-t-[#1f7a4d]" />
        იტვირთება…
      </div>
    </div>
  );
}
