import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Proactive Texas rule-change alerts for owners (tax-owner-alerts edge function,
// supabase/pt/tax-owner-alerts.sql). Owners see their own; staff review each
// alert before it goes out (unless a Super Admin turned on automatic sending).

export type MyRuleAlert = {
  deliveryId: string;
  alertId: string;
  createdAt: string;
  readAt: string | null;
  title: string;
  summary: string;
  whatChanged: string;
  effectiveDate: string | null;
  whyItMatters: string | null;
  recommendedAction: string | null;
  area: string;
  counties: string[];
  sourceName: string;
  sourceUrl: string;
  quote: string;
  properties: {
    id: string;
    address: string;
    cad: string | null;
    caseStatus: string | null;
    openCase: boolean;
  }[];
  affectsOpenCase: boolean;
};

type MyRow = {
  delivery_id: string;
  alert_id: string;
  created_at: string;
  read_at: string | null;
  title: string;
  summary: string;
  what_changed: string;
  effective_date: string | null;
  why_it_matters: string | null;
  recommended_action: string | null;
  area: string;
  counties: string[] | null;
  source_name: string;
  source_url: string;
  quote: string;
  properties: MyRuleAlert["properties"] | null;
  affects_open_case: boolean;
};

export async function myRuleAlerts(): Promise<MyRuleAlert[]> {
  const { data, error } = await supabase.rpc("my_tax_rule_alerts");
  if (error) throw error;
  return ((data ?? []) as MyRow[]).map((r) => ({
    deliveryId: r.delivery_id,
    alertId: r.alert_id,
    createdAt: r.created_at,
    readAt: r.read_at,
    title: r.title,
    summary: r.summary,
    whatChanged: r.what_changed,
    effectiveDate: r.effective_date,
    whyItMatters: r.why_it_matters,
    recommendedAction: r.recommended_action,
    area: r.area,
    counties: r.counties ?? [],
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    quote: r.quote,
    properties: r.properties ?? [],
    affectsOpenCase: r.affects_open_case,
  }));
}

export async function markRuleAlertsRead(deliveryIds: string[]) {
  if (deliveryIds.length === 0) return;
  await supabase.rpc("mark_tax_rule_alerts_read", { p_ids: deliveryIds });
}

export const CASE_STATUS_WORDS: Record<string, string> = {
  requested: "protest requested",
  filed: "protest filed",
  under_review: "under county review",
  offer_received: "settlement offer received",
  hearing_scheduled: "hearing scheduled",
  decision_received: "ARB decision received",
  appealing: "appealing",
  arbitrating: "in arbitration",
  resolved: "resolved",
};

// ── staff ────────────────────────────────────────────────────────────────────

export type OwnerAlert = {
  id: string;
  created_at: string;
  area: string;
  title: string;
  summary: string;
  what_changed: string;
  effective_date: string | null;
  why_it_matters: string | null;
  recommended_action: string | null;
  counties: string[];
  relevant_statuses: string[];
  source_name: string;
  source_url: string;
  quote: string;
  status: "pending_review" | "approved" | "sent" | "skipped";
  reviewed_at: string | null;
  review_note: string | null;
  sent_at: string | null;
  recipients: number;
  emails_sent: number;
  alert_ids: string[];
};

export async function listOwnerAlerts(): Promise<OwnerAlert[]> {
  const { data, error } = await supabase
    .from("tax_owner_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as OwnerAlert[];
}

export async function reviewOwnerAlert(id: string, approve: boolean, note?: string) {
  const { error } = await supabase.rpc("review_tax_owner_alert", {
    p_id: id,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) throw error;
  if (approve) await invokeEdgeFunction("tax-owner-alerts", { action: "send", id });
}

export function previewOwnerAlert(id: string) {
  return invokeEdgeFunction<{ owners: number; properties: number; openCases: number }>(
    "tax-owner-alerts",
    { action: "preview", id },
  );
}

export async function getAutoSend(): Promise<boolean> {
  const { data } = await supabase
    .from("app_settings")
    .select("tax_owner_alerts_auto")
    .eq("id", true)
    .maybeSingle();
  return !!(data as { tax_owner_alerts_auto?: boolean } | null)?.tax_owner_alerts_auto;
}
export async function setAutoSend(on: boolean) {
  const { error } = await supabase
    .from("app_settings")
    .update({ tax_owner_alerts_auto: on })
    .eq("id", true);
  if (error) throw error;
}
