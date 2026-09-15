import { supabase } from "./supabase";
import { addNotification } from "./notifications";
import { notifyInquiry } from "./inquiries";

// PRD 1.1.19 — "Proceed with professional assistance". No e-signature/payments
// on the static build; this records the request so staff can follow up and
// prepare a service agreement.
export type EngagementRow = {
  id: string;
  project_id: string | null;
  track: string;
  scope_summary: string | null;
  note: string | null;
  status: string;
  created_at: string;
};

export async function createEngagementRequest(input: {
  userId: string;
  projectId: string;
  track?: string;
  scopeSummary: string;
  note?: string;
  requesterEmail?: string;
  projectAddress?: string;
}): Promise<void> {
  const { error } = await supabase.from("engagement_requests").insert({
    user_id: input.userId,
    project_id: input.projectId,
    track: input.track ?? "permitting",
    scope_summary: input.scopeSummary,
    note: input.note ?? null,
  });
  if (error) throw error;
  await addNotification({
    projectId: input.projectId,
    kind: "engagement",
    title: "Professional assistance requested",
    body: "CorvusDP will follow up with a scope of services, fee schedule, and a payment schedule.",
  });
  await notifyInquiry({
    kind: "engagement",
    email: input.requesterEmail,
    message: input.note,
    meta: {
      Track: input.track ?? "permitting",
      Scope: input.scopeSummary,
      Property: input.projectAddress,
    },
  });
}

export async function getEngagementRequest(projectId: string): Promise<EngagementRow | null> {
  const { data, error } = await supabase
    .from("engagement_requests")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as EngagementRow) ?? null;
}
