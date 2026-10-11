import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import {
  listUnseenAssessmentChanges,
  markAssessmentChangesSeen,
  type AssessmentChangeRecord,
} from "@/lib/assessment-changes";
import { increaseLabel } from "../../../../supabase/pt/functions/_shared/tax-increase";
import type { PropertyRecord } from "@/lib/properties";

const fmt = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

// Changes the assessment monitor found and the owner hasn't dismissed:
// what changed, how much, and the estimated protest deadline for a new notice.
export function AssessmentChangesBanner({
  userId,
  properties,
  onReview,
}: {
  userId: string;
  properties: PropertyRecord[];
  onReview?: (p: PropertyRecord) => void;
}) {
  const [changes, setChanges] = useState<AssessmentChangeRecord[]>([]);

  useEffect(() => {
    listUnseenAssessmentChanges(userId)
      .then(setChanges)
      .catch(() => {});
  }, [userId]);

  const byId = new Map(properties.map((p) => [p.id, p]));
  const shown = changes.filter((c) => byId.has(c.propertyId));
  if (shown.length === 0) return null;

  async function dismiss(ids: string[]) {
    setChanges((prev) => prev.filter((c) => !ids.includes(c.id)));
    await markAssessmentChangesSeen(ids).catch(() => {});
  }

  return (
    <section
      aria-label="Assessment changes"
      className="rounded-lg border border-accent/40 bg-accent/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold">
            {shown.length === 1 ? "An assessment changed" : `${shown.length} assessments changed`}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dismiss(shown.map((c) => c.id))}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Dismiss all
        </button>
      </div>
      <ul className="mt-2 grid gap-2">
        {shown.map((c) => {
          const p = byId.get(c.propertyId)!;
          return (
            <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.address}</div>
                <div className="text-muted-foreground">{c.text}</div>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  {c.level && (
                    <span className="font-semibold text-warning-foreground">
                      {increaseLabel(c.level)}
                    </span>
                  )}
                  {c.protestDeadlineEstimate && (
                    <span className="text-muted-foreground">
                      Protest deadline about {fmt(c.protestDeadlineEstimate)} — check your notice
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onReview && (
                  <button
                    type="button"
                    onClick={() => {
                      onReview(p);
                      void dismiss([c.id]);
                    }}
                    className="btn-outline text-xs"
                  >
                    Review
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss([c.id])}
                  aria-label={`Dismiss the change for ${p.address}`}
                  className="text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Corvus AI re-checks every property&apos;s county record regularly and has updated the values
        and the screening above.
      </p>
    </section>
  );
}
