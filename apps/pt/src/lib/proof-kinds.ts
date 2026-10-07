import type { FilingMethod } from "./protest-form-submissions";

// Every kind of submission / confirmation proof a county filing can produce —
// one label per uploaded proof document (documents.proof_kind; the check
// constraint in supabase/pt/schema.sql lists the same ids). The AI proof check
// (verify-filing-proof) suggests one; the owner can always change it.
export const PROOF_KINDS = [
  { id: "portal_confirmation", label: "County portal confirmation" },
  { id: "county_ack_email", label: "County acknowledgement email" },
  { id: "sent_email_record", label: "Sent email record" },
  { id: "receipt", label: "Scanned / uploaded receipt" },
  { id: "screenshot", label: "Screenshot of online submission" },
  { id: "mail_receipt", label: "Mailing receipt" },
  { id: "certified_mail_receipt", label: "Certified-mail receipt" },
  { id: "delivery_record", label: "Tracking / delivery record" },
  { id: "stamped_copy", label: "Stamped copy from the county" },
  { id: "in_person_receipt", label: "In-person submission receipt" },
  { id: "county_request", label: "County request for more information" },
  { id: "other", label: "Other proof" },
] as const;

export type ProofKind = (typeof PROOF_KINDS)[number]["id"];

const IDS = new Set<string>(PROOF_KINDS.map((k) => k.id));

export function isProofKind(v: unknown): v is ProofKind {
  return typeof v === "string" && IDS.has(v);
}

export function proofKindLabel(kind: ProofKind | null | undefined): string {
  return PROOF_KINDS.find((k) => k.id === kind)?.label ?? "Unlabeled proof";
}

// The kinds that make sense for how this document was submitted — offered first
// in the picker, so a mailed filing leads with receipts and delivery records.
export const PROOF_KINDS_BY_METHOD: Record<FilingMethod, ProofKind[]> = {
  online: ["portal_confirmation", "screenshot", "county_ack_email"],
  email: ["sent_email_record", "county_ack_email", "screenshot"],
  mail: ["certified_mail_receipt", "mail_receipt", "delivery_record", "stamped_copy"],
  in_person: ["in_person_receipt", "stamped_copy", "receipt"],
};

// USPS's public tracking page — no API key; it just opens the carrier's own page.
export function uspsTrackingUrl(trackingNumber: string): string {
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(
    trackingNumber.replace(/\s+/g, ""),
  )}`;
}
