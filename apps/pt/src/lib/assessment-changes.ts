import { supabase } from "./supabase";
import {
  describeChange,
  type AssessmentChange as Change,
} from "../../../../supabase/pt/functions/_shared/assessment-monitor";
import type { IncreaseLevel } from "../../../../supabase/pt/functions/_shared/tax-increase";

// A change the assessment monitor found (monitor-assessments) that the
// owner hasn't dismissed yet.
export type AssessmentChangeRecord = Change & {
  id: string;
  propertyId: string;
  protestDeadlineEstimate: string | null;
  detectedAt: string;
  text: string;
};

type Row = {
  id: string;
  property_id: string;
  kind: "new_year" | "revised";
  tax_year: number;
  prior_year: number | null;
  prior_value: number | null;
  new_value: number;
  change_pct: number | null;
  level: IncreaseLevel | null;
  protest_deadline_estimate: string | null;
  detected_at: string;
};

export function fromRow(r: Row): AssessmentChangeRecord {
  const priorValue = r.prior_value == null ? null : Number(r.prior_value);
  const newValue = Number(r.new_value);
  const change: Change = {
    kind: r.kind,
    taxYear: r.tax_year,
    priorYear: r.prior_year,
    priorValue,
    newValue,
    landValue: null,
    improvementValue: null,
    change: priorValue != null ? newValue - priorValue : null,
    changePct: r.change_pct == null ? null : Number(r.change_pct),
    level: r.level,
  };
  return {
    ...change,
    id: r.id,
    propertyId: r.property_id,
    protestDeadlineEstimate: r.protest_deadline_estimate,
    detectedAt: r.detected_at,
    text: describeChange(change),
  };
}

export async function listUnseenAssessmentChanges(
  userId: string,
): Promise<AssessmentChangeRecord[]> {
  const { data, error } = await supabase
    .from("assessment_changes")
    .select(
      "id, property_id, kind, tax_year, prior_year, prior_value, new_value, change_pct, level, protest_deadline_estimate, detected_at",
    )
    .eq("user_id", userId)
    .is("seen_at", null)
    .order("detected_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

export async function markAssessmentChangesSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("assessment_changes")
    .update({ seen_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}
