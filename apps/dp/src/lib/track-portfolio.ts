// Everything the Train-Track Map shows across the customer's active projects:
// their permits, each permit's submission rounds and the review comments.
import { supabase } from "./supabase";
import { listProjects, type PermitRow, type ProjectRow } from "./projects";
import type { RoundComment, SubmissionRow } from "./permit-history";

export const TRACK_PORTFOLIO_KEY = "track-portfolio";

export type TrackPortfolio = {
  projects: ProjectRow[];
  permits: PermitRow[];
  submissions: SubmissionRow[];
  comments: RoundComment[];
};

export async function getTrackPortfolio(userId: string): Promise<TrackPortfolio> {
  const projects = await listProjects(userId);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { projects, permits: [], submissions: [], comments: [] };
  const [permits, submissions, comments] = await Promise.all([
    supabase.from("project_permits").select("*").in("project_id", ids).order("sort"),
    supabase.from("permit_submissions").select("*").in("project_id", ids).order("round"),
    supabase
      .from("review_comments")
      .select(
        "id, project_id, permit_key, original, plain_language, responsible, status, priority, round, discipline, assigned_at, due_at, responded_at, verified_at, created_at",
      )
      .in("project_id", ids)
      .order("created_at"),
  ]);
  if (permits.error) throw permits.error;
  if (submissions.error) throw submissions.error;
  if (comments.error) throw comments.error;
  return {
    projects,
    permits: (permits.data ?? []) as PermitRow[],
    submissions: (submissions.data ?? []) as SubmissionRow[],
    comments: (comments.data ?? []) as RoundComment[],
  };
}

export type SubmissionPatch = Partial<
  Pick<
    SubmissionRow,
    | "submitted_at"
    | "expected_at"
    | "expected_basis"
    | "city_returned_at"
    | "method"
    | "confirmation"
    | "package_version"
    | "submitted_by"
    | "notes"
  >
>;

export async function updateSubmission(id: string, patch: SubmissionPatch): Promise<void> {
  const { error } = await supabase
    .from("permit_submissions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function setCommentDue(id: string, dueAt: string | null): Promise<void> {
  const { error } = await supabase.from("review_comments").update({ due_at: dueAt }).eq("id", id);
  if (error) throw error;
}
