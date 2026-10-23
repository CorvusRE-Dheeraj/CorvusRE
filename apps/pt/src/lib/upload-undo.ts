// Taking back a document uploaded to a case by mistake (the Replace / Remove
// buttons next to each upload). Each function removes the upload's own record,
// soft-deletes the file (it stays restorable from Documents → Recently deleted)
// and reverts only what that upload changed on the case. Each returns the
// protest patch the caller applies to its local state.
import { supabase } from "./supabase";
import { notifyDocumentsChanged } from "./documents";
import type { ProtestRecord } from "./protests";
import type { HearingNoticeRecord } from "./hearing-notice";
import type { DecisionNoticeRecord } from "./decision-notice";
import { undoFormalOutcome, undoInformalSettlement } from "./protest-case";
import { logCaseEvent } from "./case-audit";

export async function softDeleteDocuments(ids: (string | null | undefined)[]): Promise<void> {
  const real = ids.filter((x): x is string => !!x);
  if (real.length === 0) return;
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", real);
  if (error) throw error;
  notifyDocumentsChanged();
}

function logCaseNote(protestId: string, message: string): void {
  void logCaseEvent(protestId, "status_change", message, {});
}

// The hearing notice: its record and file go; the hearing it scheduled goes
// with it — or falls back to the previous notice's hearing, if there was one.
export async function removeHearingNotice(
  protest: ProtestRecord,
  notice: HearingNoticeRecord,
): Promise<{ patch: Partial<ProtestRecord>; previous: HearingNoticeRecord | null }> {
  const { error: delErr } = await supabase.from("hearing_notices").delete().eq("id", notice.id);
  if (delErr) throw delErr;
  await softDeleteDocuments([notice.documentId]);

  const { data } = await supabase
    .from("hearing_notices")
    .select("id")
    .eq("protest_id", protest.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const { getLatestHearingNotice } = await import("./hearing-notice");
  const previous = data && data.length > 0 ? await getLatestHearingNotice(protest.id) : null;

  // Only touch the hearing if it's the one this notice set.
  const fromThisNotice = !!notice.hearingDate && protest.hearingDate === notice.hearingDate;
  let patch: Partial<ProtestRecord> = {};
  if (fromThisNotice) {
    patch = previous?.hearingDate
      ? {
          hearingDate: previous.hearingDate,
          hearingTime: previous.hearingTime ?? null,
          hearingLocation: previous.hearingLocation ?? null,
          hearingMode: previous.hearingMode ?? null,
        }
      : {
          hearingDate: null,
          hearingTime: null,
          hearingLocation: null,
          hearingMode: null,
          ...(protest.status === "hearing_scheduled" ? { status: "filed" as const } : {}),
        };
    const { error } = await supabase
      .from("protests")
      .update({
        hearing_date: patch.hearingDate ?? null,
        hearing_time: patch.hearingTime ?? null,
        hearing_location: patch.hearingLocation ?? null,
        hearing_mode: patch.hearingMode ?? null,
        ...(patch.status ? { status: patch.status } : {}),
      })
      .eq("id", protest.id);
    if (error) throw error;
  }
  logCaseNote(protest.id, "Hearing notice removed by the owner (uploaded by mistake).");
  return { patch, previous };
}

// The decision document: its record and file go, and the decision it recorded
// is undone (the case reopens at the formal hearing).
export async function removeDecisionNotice(
  protest: ProtestRecord,
  notice: DecisionNoticeRecord,
): Promise<Partial<ProtestRecord>> {
  const { error: delErr } = await supabase.from("decision_notices").delete().eq("id", notice.id);
  if (delErr) throw delErr;
  await softDeleteDocuments([notice.documentId]);
  const fromThisNotice =
    protest.arbDecision != null &&
    notice.finalValue != null &&
    protest.finalValue === notice.finalValue;
  if (!fromThisNotice) return {};
  if (protest.status === "resolved") return undoFormalOutcome(protest);
  const status: ProtestRecord["status"] = protest.hearingDate ? "hearing_scheduled" : "filed";
  const { error } = await supabase
    .from("protests")
    .update({ arb_decision: null, arb_decision_date: null, final_value: null, status })
    .eq("id", protest.id);
  if (error) throw error;
  logCaseNote(protest.id, "Decision document removed by the owner (uploaded by mistake).");
  return { arbDecision: null, arbDecisionDate: null, finalValue: null, status };
}

// The district's evidence: its analysis and files go, and it's back to "not
// received yet" (Tax Code §41.461 evidence still has to come in).
export async function removeCadEvidence(protest: ProtestRecord): Promise<Partial<ProtestRecord>> {
  const { data } = await supabase
    .from("cad_evidence_reviews")
    .select("document_ids")
    .eq("protest_id", protest.id)
    .maybeSingle();
  const { error: delErr } = await supabase
    .from("cad_evidence_reviews")
    .delete()
    .eq("protest_id", protest.id);
  if (delErr) throw delErr;
  await softDeleteDocuments(((data?.document_ids as string[] | null) ?? []).slice());
  const { error } = await supabase
    .from("protests")
    .update({ cad_evidence_received_at: null })
    .eq("id", protest.id);
  if (error) throw error;
  logCaseNote(protest.id, "District evidence removed by the owner (uploaded by mistake).");
  return { cadEvidenceReceivedAt: null };
}

// The settlement document: the settlement is undone (case reopens at the
// informal review) and its file goes — the newest settlement upload for the
// property when the caller doesn't have its id.
export async function removeSettlement(
  protest: ProtestRecord,
  file: { documentId?: string | null; propertyId: string; documentType: string },
): Promise<Partial<ProtestRecord>> {
  const patch = await undoInformalSettlement(protest);
  let id = file.documentId ?? null;
  if (!id) {
    const { data } = await supabase
      .from("documents")
      .select("id")
      .eq("property_id", file.propertyId)
      .eq("document_type", file.documentType)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    id = (data?.[0]?.id as string | undefined) ?? null;
  }
  await softDeleteDocuments([id]);
  return patch;
}

// The newest file of one kind for a property (a case-record item's upload).
export async function removeLatestDocumentOfType(
  propertyId: string,
  documentType: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("documents")
    .select("id")
    .eq("property_id", propertyId)
    .eq("document_type", documentType)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  const id = (data?.[0]?.id as string | undefined) ?? null;
  await softDeleteDocuments([id]);
  return id;
}
