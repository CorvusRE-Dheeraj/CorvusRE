import { createContext } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import {
  buildCaseOutcome,
  caseStageLabel,
  outcomeRouteLabel,
  type CaseOutcome,
} from "@/lib/case-outcome";
import { currency } from "@/lib/intake-store";

// The strip at the top of every AI Report module once a protest exists: the modules'
// own analysis was written before the protest, so this says where the case really
// stands — still in progress (and which stage), or finished (final value, what it
// saved, and how it ended). Nothing shows until a protest has been filed.
export function CaseOutcomeBanner({
  protest,
  property,
  onViewCase,
}: {
  protest: ProtestRecord | null;
  property: PropertyRecord | null;
  onViewCase: () => void;
}) {
  if (!protest || !property || protest.status === "requested") return null;

  if (protest.status === "resolved") {
    const o = buildCaseOutcome(property, protest);
    return (
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            <div className="font-semibold">Protest completed</div>
            <p className="text-muted-foreground">
              Resolved through {outcomeRouteLabel(protest)}
              {o?.finalValue != null ? ` at ${currency(o.finalValue)}` : ""}
              {o?.originalValue != null && o.finalValue != null
                ? ` (was ${currency(o.originalValue)})`
                : ""}
              {o?.taxSavings ? ` — about ${currency(o.taxSavings)}/yr in tax saved` : ""}. The
              analysis below is from before your protest, kept for reference.
            </p>
          </div>
        </div>
        <button type="button" onClick={onViewCase} className="btn-outline shrink-0 text-xs py-1.5">
          View Case Outcome
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <div className="font-semibold">Your protest is in progress</div>
          <p className="text-muted-foreground">
            Current stage: {caseStageLabel(protest)}. Open the case for what to do next.
          </p>
        </div>
      </div>
      <button type="button" onClick={onViewCase} className="btn-accent shrink-0 text-xs py-1.5">
        View Case
      </button>
    </div>
  );
}

// The finished-case figures, provided once around the module cards so any card can
// show what actually happened instead of the pre-protest estimate. null = no
// completed protest.
export const CaseResultContext = createContext<CaseOutcome | null>(null);
