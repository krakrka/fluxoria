export function SkeletonBlock() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-stone-200" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-2xl bg-stone-200" />
        <div className="h-28 animate-pulse rounded-2xl bg-stone-200" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-stone-200" />
    </div>
  );
}
