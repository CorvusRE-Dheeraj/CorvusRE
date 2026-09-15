import { invokeEdgeFunction } from "./edge-functions";

// One notification path for every real, intentional inquiry — contact
// form, "proceed with professional assistance" engagement requests, and
// the construction intake form — all forwarded to staff by email
// (send-inquiry-email). Deliberately not wired to the passive lead capture
// in src/lib/leads.ts (that fires in the background on routine wizard
// usage, not someone reaching out) — see that function's own comment.
export type InquiryKind = "contact" | "engagement" | "construction_lead";

type InquiryInput = {
  kind: InquiryKind;
  name?: string;
  email?: string;
  company?: string;
  phone?: string;
  message?: string;
  meta?: Record<string, unknown>;
};

// For the contact form, where this email IS the submission — nothing else
// gets saved anywhere, so a real failure has to surface to the user (so
// they know to retry or reach out another way) rather than being silently
// swallowed.
export async function sendInquiry(input: InquiryInput): Promise<void> {
  await invokeEdgeFunction("send-inquiry-email", input);
}

// For engagement requests / construction intake, where the real record
// (engagement_requests row, leads row) is already saved by the time this
// runs — this is a supplementary staff notification on top of that, so a
// failure here must never turn an already-successful submission into an
// error screen for the user.
export async function notifyInquiry(input: InquiryInput): Promise<void> {
  try {
    await sendInquiry(input);
  } catch (err) {
    console.error("Inquiry notification failed (non-blocking):", err);
  }
}
