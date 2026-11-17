/** Shown at once while a counting screen loads. */
export default function Loading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <div className="flex items-center gap-3 text-sm text-ink-faint">
        <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-rule border-t-accent" />
        იტვირთება…
      </div>
    </div>
  );
}
