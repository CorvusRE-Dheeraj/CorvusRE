import { Skeleton } from "@/components/ui/skeleton";

// A shimmering placeholder shaped like a page of cards, shown while data loads — friendlier
// than a lone "Loading…" line and it stops the layout from jumping when content arrives.
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-6 grid gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card-elev flex items-center gap-4 p-5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
