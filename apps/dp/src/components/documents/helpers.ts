// Small shared helpers for the Documents page views and dialogs.
import type { PermitRow } from "@/lib/projects";
import {
  nextRound,
  type ImportStatus,
  type PrepStatus,
  type VersionRow,
} from "@/lib/doc-workspace";
import type { DocCtx } from "./views";

export const prepTone = (p: PrepStatus): "green" | "red" | "blue" | "amber" | "gray" =>
  p === "ready"
    ? "green"
    : p === "missing" || p === "revision_required"
      ? "red"
      : p === "received"
        ? "blue"
        : "amber";
export const importTone = (s: ImportStatus): "green" | "red" | "blue" | "amber" | "gray" =>
  s === "filed" ? "green" : s === "ready" ? "blue" : s === "needs_review" ? "amber" : "gray";
export const releaseTone = (r: VersionRow["release_status"]) =>
  r === "released" ? "green" : r === "city_approved" ? "blue" : "amber";

export function destinationLabel(c: DocCtx, dest: string, permitId: string | null): string {
  if (dest === "draft" && permitId)
    return `Working Submission ${nextRound(c.ws.submissions, permitId)} · pending review`;
  if (dest.startsWith("support:")) {
    const s = c.ws.submissions.find((x) => x.id === dest.slice(8));
    return s ? `Submission ${s.round} · supporting record only` : "Round unavailable";
  }
  return "Library · round not assigned";
}

// open comments from the permit's latest round (what the next package answers)
export function openRoundComments(c: DocCtx, p: PermitRow) {
  const last = c.ws.submissions.filter((s) => s.permit_id === p.id).at(-1);
  return c.ws.comments.filter(
    (cm) =>
      cm.permit_key === p.permit_key && (!last || cm.round == null || cm.round === last.round),
  );
}
