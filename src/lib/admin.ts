import { supabase } from "./supabase";

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return (data as { is_admin?: boolean } | null)?.is_admin ?? false;
}

export type LeadRow = {
  id: string;
  session_id: string | null;
  track: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
  property: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  design: Record<string, unknown> | null;
  intent_score: number;
  status: string;
  created_at: string;
};

export async function listLeads(): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as LeadRow[]) ?? [];
}

export type AdminProjectRow = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  jurisdiction: string | null;
  feasibility_status: string | null;
  complexity_level: string | null;
  stage: string;
  track: string;
  created_at: string;
};

export async function listAllProjects(): Promise<AdminProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, address, city, jurisdiction, feasibility_status, complexity_level, stage, track, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data as AdminProjectRow[]) ?? [];
}

export type AdminDesignRow = {
  id: string;
  address: string | null;
  city: string | null;
  scope: string | null;
  sector: string | null;
  stage: string;
  created_at: string;
};

export async function listAllDesignRequests(): Promise<AdminDesignRow[]> {
  const { data, error } = await supabase
    .from("design_requests")
    .select("id, address, city, scope, sector, stage, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data as AdminDesignRow[]) ?? [];
}

// Cross-project permit tracker (PRD 2.1.47 Number of Submission Tracker,
// 2.1.48 Permit Aging & Risk Monitoring, 2.1.51 Permit Approval Tracker,
// 2.1.52 Permit Expiry Tracker) — one admin view over the same
// project_permits rows the customer dashboard already tracks per-project.
// Readable cross-project because owns_project()'s RLS check already ORs in
// public.is_admin() (see schema.sql) — no new policy needed.
export type AdminPermitRow = {
  id: string;
  project_id: string;
  name: string;
  category: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  expiry_date: string | null;
  current_reviewer: string | null;
  created_at: string;
  project_address: string | null;
};

type ProjectsEmbed = { address: string | null; name: string | null } | null;

export async function listAllPermits(): Promise<AdminPermitRow[]> {
  const { data, error } = await supabase
    .from("project_permits")
    .select(
      "id, project_id, name, category, status, submitted_at, approved_at, expiry_date, current_reviewer, created_at, projects(address, name)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as unknown as (AdminPermitRow & { projects: ProjectsEmbed })[]).map(
    (row) => ({
      ...row,
      project_address: row.projects?.address ?? row.projects?.name ?? null,
    }),
  );
}

// Cross-project document repository (PRD 2.1.9 Create Document Database for
// each project) — admin-side browse of everything uploaded to the
// `project-docs` storage bucket, whichever project it's attached to.
export type AdminDocumentRow = {
  id: string;
  project_id: string;
  name: string;
  category: string;
  storage_path: string | null;
  created_at: string;
  project_address: string | null;
};

export async function listAllDocuments(): Promise<AdminDocumentRow[]> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("id, project_id, name, category, storage_path, created_at, projects(address, name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return ((data ?? []) as unknown as (AdminDocumentRow & { projects: ProjectsEmbed })[]).map(
    (row) => ({
      ...row,
      project_address: row.projects?.address ?? row.projects?.name ?? null,
    }),
  );
}

export async function getDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("project-docs")
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// "Proceed with professional assistance" follow-up queue (PRD 1.1.19 /
// 2.1.31 Contract Finalization with Developer) — until now, a customer's
// engagement_requests row had nowhere for staff to actually see or act on
// it.
export type AdminEngagementRow = {
  id: string;
  project_id: string | null;
  user_id: string | null;
  track: string;
  scope_summary: string | null;
  note: string | null;
  status: string;
  created_at: string;
  project_address: string | null;
  requester_email: string | null;
};

export async function listEngagementRequests(): Promise<AdminEngagementRow[]> {
  const { data, error } = await supabase
    .from("engagement_requests")
    .select("id, project_id, user_id, track, scope_summary, note, status, created_at, projects(address, name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as (AdminEngagementRow & { projects: ProjectsEmbed })[];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    for (const p of (profiles ?? []) as { id: string; email: string }[]) {
      emailByUserId.set(p.id, p.email);
    }
  }

  return rows.map((row) => ({
    ...row,
    project_address: row.projects?.address ?? row.projects?.name ?? null,
    requester_email: row.user_id ? (emailByUserId.get(row.user_id) ?? null) : null,
  }));
}

export async function updateEngagementStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("engagement_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

// "Task - AI Logs and Outputs" — every real AI call's input/output, written
// by the Edge Functions themselves (supabase/functions/_shared/ai-log.ts)
// via the service-role key. Admin-only read (see the ai_logs RLS policy).
export type AiLogRow = {
  id: string;
  kind: string;
  user_id: string | null;
  input: unknown;
  output: unknown;
  created_at: string;
};

export async function listAiLogs(): Promise<AiLogRow[]> {
  const { data, error } = await supabase
    .from("ai_logs")
    .select("id, kind, user_id, input, output, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as AiLogRow[]) ?? [];
}

export async function logAdminAction(input: {
  action: string;
  target?: string;
  detail?: string;
}): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: input.action,
      target: input.target ?? null,
      detail: input.detail ?? null,
    });
  } catch (err) {
    console.error("audit log failed", err);
  }
}
