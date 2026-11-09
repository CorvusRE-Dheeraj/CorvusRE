import { type CompsResult } from "@/lib/cad-comps";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: shared.
export type ModuleAsyncState = {
  data: unknown;
  loading: boolean;
  error: string | null;
  // When this data came from public.module_results rather than a fresh AI
  // call — drives the "Updated {time}" line next to Regenerate.
  cachedAt?: string;
  // Re-running in the background (e.g. after marking a factor N/A): the
  // data above stays on screen until the new result arrives.
  refreshing?: boolean;
  // Set when `error` is the per-user request limit (RateLimitError): the
  // time (ms since epoch) it lifts. The card shows the error text itself,
  // and the auto-retry waits until then instead of hitting the limit again.
  rateLimitedUntil?: number;
};

// Real comps-derived signal fed into Module 2's prompt (see loadModule() below) —
// median/min/max of the same real comparable market values CompsMap/CompsValueScatter
// already render, not a new fetch or an invented figure.
export function buildCompsSummary(compsData: CompsResult | null) {
  const values = (compsData?.comps ?? [])
    .map((c) => c.marketValue)
    .filter((v): v is number => v != null);
  if (values.length === 0 || !compsData) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: compsData.comps.length,
  };
}
