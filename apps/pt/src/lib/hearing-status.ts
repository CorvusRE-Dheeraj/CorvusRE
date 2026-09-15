import type { ProtestRecord } from "./protests";

// Deterministic user-facing hearing status — no AI, no new DB column. Every
// input is already a real field this app has (protest.status/hearingDate,
// whether a real hearing notice is on file, how much evidence is uploaded),
// so this is just a straightforward function of state, same discipline as
// case-guidance.ts's stage derivation. Deliberately the narrow 4-value set
// the product asked for, not the richer internal ProtestStatus.
export type HearingUserStatus =
  "Hearing Scheduled" | "No Action Needed" | "Upload Documents" | "Attend Hearing";

const DAY_MS = 24 * 60 * 60 * 1000;

// Same local-midnight parsing as case-guidance.ts's formatDate — a
// date-only string parsed as-is reads as UTC midnight, which rolls the
// "days until" count back a day for anyone west of UTC.
function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  return Math.ceil((target - Date.now()) / DAY_MS);
}

export function getHearingUserStatus(
  protest: ProtestRecord,
  hasHearingNotice: boolean,
  evidenceDocumentCount: number,
): HearingUserStatus {
  if (protest.status !== "hearing_scheduled" || !protest.hearingDate) return "No Action Needed";

  const remaining = daysUntil(protest.hearingDate);
  if (remaining <= 1) return "Attend Hearing";

  // A real hearing is coming up but the case is still missing something
  // real and actionable — the notice itself, or any evidence at all.
  if (!hasHearingNotice || evidenceDocumentCount === 0) return "Upload Documents";

  return "Hearing Scheduled";
}
