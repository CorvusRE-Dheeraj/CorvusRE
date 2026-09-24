import { supabase } from "./supabase";
import { notifyStaff } from "./staff-notification";

export type ProtestStatus =
  | "requested"
  | "filed"
  | "under_review"
  | "offer_received"
  | "hearing_scheduled"
  | "decision_received"
  | "appealing"
  | "arbitrating"
  | "resolved";

export type ArbDecision = "approved" | "partial" | "denied";
export type EscalationPath = "accept" | "appeal" | "arbitration";

// Finer-grained than ProtestStatus — see the schema.sql comment on
// protests.informal_status for why this is a separate column rather than
// new ProtestStatus values.
export type InformalStatus =
  | "not_requested"
  | "requested"
  | "pending_response"
  | "scheduled"
  | "proposed_value_received"
  | "accepted"
  | "rejected"
  | "no_informal_available"
  | "completed";

// The real, shorter label set the user actually sees — several internal
// InformalStatus values collapse to the same honest user-facing phrase
// rather than exposing all 8 as their own confusing badge text.
export const INFORMAL_STATUS_LABEL: Record<InformalStatus, string> = {
  not_requested: "Not Requested",
  requested: "Informal Review Pending",
  pending_response: "Informal Review Pending",
  scheduled: "Informal Review Scheduled",
  proposed_value_received: "Offer Received",
  accepted: "Offer Accepted",
  rejected: "Formal Hearing Needed",
  no_informal_available: "Formal Hearing Needed",
  completed: "Informal Review Completed",
};

export type AppraiserCategory =
  | "Land Appraiser"
  | "Improvement Appraiser"
  | "Commercial Appraiser"
  | "Retail Appraiser"
  | "Office Appraiser"
  | "Daycare/School Appraiser"
  | "Other";

// Who will actually attend the hearing — see HearingPrepSection in
// CaseDetailModal.tsx. User-selected, not inferred: an Appointment of
// Agent (Form 50-162) on file means an agent CAN attend, not that they
// will.
export type AttendanceType = "Property Owner" | "Authorized Agent" | "Both";

export type ProtestRecord = {
  id: string;
  // Exactly one of propertyId/bppAccountId is ever set — a BPP protest has
  // no property_id (see protests_subject_check in schema.sql). Real-estate
  // code that only ever reads/creates property-backed protests (the
  // overwhelming majority of this codebase) can keep treating propertyId as
  // present; it's typed nullable so a BPP row round-trips honestly instead
  // of lying about having a property.
  propertyId: string | null;
  // Optional (not just nullable), same reason as informalReviewTime/
  // filingConfirmationNumber below: the many ProtestRecord fixtures/builders
  // that predate BPP don't all need updating; fromRow (the real path)
  // always populates it.
  bppAccountId?: string | null;
  status: ProtestStatus;
  notes: string | null;
  requestedAt: string;
  updatedAt: string;
  originalValue: number | null;
  settlementOfferValue: number | null;
  settlementOfferReceivedAt: string | null;
  hearingDate: string | null;
  // Real detail from an actual uploaded hearing notice (see
  // extract-hearing-notice / hearing-notice.ts) — null whenever the hearing
  // date was set manually instead (CaseProgress's own date input), same as
  // hearingDate was before this existed.
  hearingTime: string | null;
  hearingLocation: string | null;
  hearingMode: "In Person" | "Phone" | "Videoconference" | "Affidavit" | "Unknown" | null;
  // Owner marked the formal hearing as held (optional so older fixtures stay valid).
  hearingCompletedAt?: string | null;
  arbDecision: ArbDecision | null;
  arbDecisionDate: string | null;
  finalValue: number | null;
  escalationPath: EscalationPath | null;
  closedAt: string | null;
  taxYear: number | null;
  // When the customer acknowledged Corvus's "AI Guidance & Filing Notice" —
  // null until then, never reset once set. See CorvusGuidanceGate in
  // CaseDetailModal.tsx, which gates entry into a not-yet-filed case on this.
  corvusGuidanceAckAt: string | null;
  informalStatus: InformalStatus;
  informalReviewDate: string | null;
  informalAppraiserCategory: AppraiserCategory | null;
  attendanceType: AttendanceType | null;
  // Time-of-day and mode the owner scheduled the informal review for — the
  // same treatment hearingTime/hearingMode get above, read by the calendar
  // builders to put a real time in the informal-review event. Optional (not
  // just nullable), same reason as the case-record fields below: the many
  // ProtestRecord fixtures/builders that predate them don't all need
  // updating; fromRow (the real path) always populates them.
  informalReviewTime?: string | null;
  informalReviewMode?: "In Person" | "Phone" | "Videoconference" | "Affidavit" | "Unknown" | null;
  // Case-record fields — see src/lib/case-record.ts. Optional (not just
  // nullable) so the many ProtestRecord fixtures/builders that predate them
  // don't all need updating; fromRow (the real path) always populates them.
  filingConfirmationNumber?: string | null;
  filingChannel?: "online" | "mail" | "in_person" | "email" | null;
  certifiedMailTracking?: string | null;
  evidenceSubmittedConfirmedAt?: string | null;
  // Who at CorvusPT is actually handling this case — admin-set (see
  // updateProtestAssignedRep in admin.ts), read here so HearingPrepSection
  // can show it to the customer. Same optional-fixture convention as the
  // fields above.
  assignedRepresentative?: string | null;
  assignedRepSetAt?: string | null;
};

type ProtestRow = {
  id: string;
  property_id: string | null;
  bpp_account_id: string | null;
  status: ProtestStatus;
  notes: string | null;
  requested_at: string;
  updated_at: string;
  original_value: number | null;
  settlement_offer_value: number | null;
  settlement_offer_received_at: string | null;
  hearing_date: string | null;
  hearing_completed_at?: string | null;
  hearing_time: string | null;
  hearing_location: string | null;
  hearing_mode: "In Person" | "Phone" | "Videoconference" | "Affidavit" | "Unknown" | null;
  arb_decision: ArbDecision | null;
  arb_decision_date: string | null;
  final_value: number | null;
  escalation_path: EscalationPath | null;
  closed_at: string | null;
  tax_year: number | null;
  corvus_guidance_ack_at: string | null;
  informal_status: InformalStatus;
  informal_review_date: string | null;
  informal_review_time: string | null;
  informal_review_mode: "In Person" | "Phone" | "Videoconference" | "Affidavit" | "Unknown" | null;
  informal_appraiser_category: AppraiserCategory | null;
  attendance_type: AttendanceType | null;
  filing_confirmation_number: string | null;
  filing_channel: "online" | "mail" | "in_person" | "email" | null;
  certified_mail_tracking: string | null;
  evidence_submitted_confirmed_at: string | null;
  assigned_representative: string | null;
  assigned_rep_set_at: string | null;
};

const SELECT_COLUMNS =
  "id, property_id, bpp_account_id, status, notes, requested_at, updated_at, original_value, settlement_offer_value, settlement_offer_received_at, hearing_date, hearing_completed_at, hearing_time, hearing_location, hearing_mode, arb_decision, arb_decision_date, final_value, escalation_path, closed_at, tax_year, corvus_guidance_ack_at, informal_status, informal_review_date, informal_review_time, informal_review_mode, informal_appraiser_category, attendance_type, filing_confirmation_number, filing_channel, certified_mail_tracking, evidence_submitted_confirmed_at, assigned_representative, assigned_rep_set_at";

function fromRow(row: ProtestRow): ProtestRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    bppAccountId: row.bpp_account_id,
    status: row.status,
    notes: row.notes,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    originalValue: row.original_value,
    settlementOfferValue: row.settlement_offer_value,
    settlementOfferReceivedAt: row.settlement_offer_received_at,
    hearingDate: row.hearing_date,
    hearingCompletedAt: row.hearing_completed_at,
    hearingTime: row.hearing_time,
    hearingLocation: row.hearing_location,
    hearingMode: row.hearing_mode,
    arbDecision: row.arb_decision,
    arbDecisionDate: row.arb_decision_date,
    finalValue: row.final_value,
    escalationPath: row.escalation_path,
    closedAt: row.closed_at,
    taxYear: row.tax_year,
    corvusGuidanceAckAt: row.corvus_guidance_ack_at,
    informalStatus: row.informal_status,
    informalReviewDate: row.informal_review_date,
    informalReviewTime: row.informal_review_time,
    informalReviewMode: row.informal_review_mode,
    informalAppraiserCategory: row.informal_appraiser_category,
    attendanceType: row.attendance_type,
    filingConfirmationNumber: row.filing_confirmation_number,
    filingChannel: row.filing_channel,
    certifiedMailTracking: row.certified_mail_tracking,
    evidenceSubmittedConfirmedAt: row.evidence_submitted_confirmed_at,
    assignedRepresentative: row.assigned_representative,
    assignedRepSetAt: row.assigned_rep_set_at,
  };
}

// Filing and hearing representation happen off-platform by CorvusPT staff (per the
// /property-protest page's own description) — this creates the real request record
// staff act on; there is no automated filing today, so status only ever advances via
// the admin panel or the case-progress actions in protest-case.ts. `details` is used
// only for the staff notification below and the original-value snapshot — the
// request itself is fully recorded in the DB regardless of whether that send works.
export async function requestProtest(
  userId: string,
  propertyId: string,
  details?: {
    address?: string;
    userEmail?: string;
    originalValue?: number | null;
    taxYear?: number | null;
  },
): Promise<ProtestRecord> {
  const { data, error } = await supabase
    .from("protests")
    .insert({
      property_id: propertyId,
      user_id: userId,
      original_value: details?.originalValue ?? null,
      tax_year: details?.taxYear ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  const created = fromRow(data as ProtestRow);

  // Best-effort staff notification — previously a request only surfaced if staff
  // happened to check the admin panel's "Protest Requests" list themselves.
  const address = details?.address ?? `property ${propertyId}`;
  notifyStaff({
    subject: "New protest filing request — CorvusPT.ai",
    replyToEmail: details?.userEmail,
    message: `A protest filing was requested for ${address} by ${details?.userEmail ?? `user ${userId}`}. Update its status in the admin panel.`,
  }).catch((err) => console.error("Protest request staff notification failed:", err));

  return created;
}

// BPP sibling of requestProtest above — same shape, but keyed to a BPP
// account instead of a property (bpp_is_paid() gates the insert server-side,
// same as property_is_paid() does for requestProtest). Only makes sense once
// the county's own notice_value actually disagrees with what was rendered
// (see bppNeedsProtest in bpp-accounts.ts) — callers check that before
// offering this, same as the UI-level isPaid checks around requestProtest.
export async function requestBppProtest(
  userId: string,
  bppAccountId: string,
  details?: {
    businessName?: string;
    userEmail?: string;
    originalValue?: number | null;
    taxYear?: number | null;
  },
): Promise<ProtestRecord> {
  const { data, error } = await supabase
    .from("protests")
    .insert({
      bpp_account_id: bppAccountId,
      user_id: userId,
      original_value: details?.originalValue ?? null,
      tax_year: details?.taxYear ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  const created = fromRow(data as ProtestRow);

  const businessName = details?.businessName ?? `BPP account ${bppAccountId}`;
  notifyStaff({
    subject: "New BPP protest filing request — CorvusPT.ai",
    replyToEmail: details?.userEmail,
    message: `A BPP protest filing was requested for ${businessName} by ${details?.userEmail ?? `user ${userId}`}. Update its status in the admin panel.`,
  }).catch((err) => console.error("BPP protest request staff notification failed:", err));

  return created;
}

// Records BPP's own agreement acceptance + owner info + AI acknowledgement +
// e-signature — all on the protests row itself (bpp_* columns added in
// schema.sql) rather than the real-estate flow's separate
// service_agreement_acceptances/protest_authorizations tables. See
// BppProtestFlow.tsx: everything is held in component state across its
// wizard steps and written here in one call once the owner actually signs,
// since (unlike the real-estate flow) there's no protest row to attach an
// early "agreement accepted" write to until requestBppProtest() above has
// already run.
export async function saveBppAuthorization(
  protestId: string,
  authorization: {
    ownerFirstName: string;
    ownerLastName: string;
    ownerEmail: string;
    ownerPhone: string;
    signatureType: "draw" | "type";
    signatureData: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("protests")
    .update({
      bpp_agreement_accepted_at: now,
      bpp_owner_first_name: authorization.ownerFirstName,
      bpp_owner_last_name: authorization.ownerLastName,
      bpp_owner_email: authorization.ownerEmail,
      bpp_owner_phone: authorization.ownerPhone,
      bpp_ai_ack_at: now,
      bpp_signature_type: authorization.signatureType,
      bpp_signature_data: authorization.signatureData,
      bpp_signed_at: now,
    })
    .eq("id", protestId);
  if (error) throw error;
}

// Records that the customer has acknowledged Corvus's "AI Guidance & Filing
// Notice" for this case — see CorvusGuidanceGate in CaseDetailModal.tsx. A
// one-way write (no "un-acknowledge"); the gate only ever checks whether this
// is null, never re-shown once set.
export async function acknowledgeGuidance(protestId: string): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ corvus_guidance_ack_at: new Date().toISOString() })
    .eq("id", protestId);
  if (error) throw error;
}

// Fixes the one real scenario the Pre-Filing Check's Tax Year row can flag
// that editing the PROPERTY record can never resolve: protests.tax_year is a
// snapshot captured once at requestProtest() time, so it goes stale if the
// property's own tax_year later rolls to a new year (a new CAD cycle lands)
// while this protest is still in progress. See getPreFilingCheck's
// resolveField: "protest" in pre-filing-check.ts.
export async function updateProtestTaxYear(
  protestId: string,
  taxYear: number,
): Promise<{ taxYear: number }> {
  const { error } = await supabase
    .from("protests")
    .update({ tax_year: taxYear })
    .eq("id", protestId);
  if (error) throw error;
  return { taxYear };
}

export async function listProtests(userId: string): Promise<ProtestRecord[]> {
  const { data, error } = await supabase
    .from("protests")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data as ProtestRow[]).map(fromRow);
}
