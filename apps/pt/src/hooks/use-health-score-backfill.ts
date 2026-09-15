import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { PropertyRecord } from "@/lib/properties";
import { computeAndStoreHealthScore, type PropertyAiScore } from "@/lib/property-scores";

// Mirrors use-savings-backfill.ts's exact pattern, for the same reason: properties
// added before property_ai_scores existed, or where the background compute at
// add-time failed/was slow, would otherwise sit with no AI score forever — there was
// no retroactive job. This computes and persists the missing score once per property
// (guarded by a ref so the same property is never fired twice concurrently),
// regardless of which dashboard page happens to read healthScores first.
export function useHealthScoreBackfill(
  properties: PropertyRecord[],
  healthScores: Record<string, PropertyAiScore>,
  setHealthScores: Dispatch<SetStateAction<Record<string, PropertyAiScore>>>,
) {
  const backfilling = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = properties.filter(
      (p) => !healthScores[p.id] && p.totalValue != null && !backfilling.current.has(p.id),
    );
    for (const p of missing) {
      backfilling.current.add(p.id);
      computeAndStoreHealthScore(p)
        .then((result) => {
          if (!result) return;
          setHealthScores((prev) => ({ ...prev, [p.id]: result }));
        })
        .catch((err) => console.error("Health score backfill failed:", err));
    }
  }, [properties, healthScores, setHealthScores]);
}
