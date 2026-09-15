import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

// Shared "does this property need action" signal, used by both the dashboard
// home nudge banner and the Properties page's per-property badges — a single
// source of truth rather than two copies of the same deadline math. Everything
// here is derived from fields already on file (protest deadline, whether a
// protest request exists); there's no prior-year comparison because this app
// doesn't persist value history to compare against.
export type ActionStatus = "needs_action" | "in_progress" | "resolved" | "on_track";

const NEEDS_ACTION_WINDOW_DAYS = 14;

export function getPropertyProtestStatus(
  property: PropertyRecord,
  protests: ProtestRecord[],
): { status: ActionStatus; label: string; daysLeft: number | null } {
  const protest = protests.find((p) => p.propertyId === property.id);

  if (protest) {
    if (protest.status === "resolved") {
      return { status: "resolved", label: "Resolved", daysLeft: null };
    }
    return { status: "in_progress", label: PROTEST_STATUS_LABEL[protest.status], daysLeft: null };
  }

  if (!property.protestDeadline) {
    return { status: "on_track", label: "No deadline on file", daysLeft: null };
  }

  const daysLeft = Math.ceil(
    (new Date(property.protestDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (daysLeft <= NEEDS_ACTION_WINDOW_DAYS) {
    return {
      status: "needs_action",
      label: daysLeft < 0 ? "Deadline passed" : daysLeft === 0 ? "Due today" : `${daysLeft} days left`,
      daysLeft,
    };
  }

  return { status: "on_track", label: `${daysLeft} days left`, daysLeft };
}

const PROTEST_STATUS_LABEL: Record<ProtestRecord["status"], string> = {
  requested: "Requested",
  filed: "Filed",
  under_review: "Under Review",
  offer_received: "Offer Received",
  hearing_scheduled: "Hearing Scheduled",
  decision_received: "Decision Received",
  appealing: "Appealing",
  arbitrating: "Arbitrating",
  resolved: "Resolved",
};
