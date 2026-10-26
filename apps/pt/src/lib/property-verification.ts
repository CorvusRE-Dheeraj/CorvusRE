// Client side of the property & document check (verify-property edge
// function; rules in supabase/pt/functions/_shared/property-verification.ts,
// database side in supabase/pt/property-verification.sql). The browser only
// ever asks for a check — the result is written by the server, and the
// database holds signing/filing for a property that isn't verified.
import { invokeEdgeFunction } from "./edge-functions";
import {
  GENERATED_DOCUMENT_TYPES,
  type VerificationFlag,
} from "../../../../supabase/pt/functions/_shared/property-verification";
import { supabase } from "./supabase";

export type { VerificationFlag };
export type PropertyVerificationStatus =
  "pending" | "verified" | "needs_review" | "rejected" | "test";

export type VerificationResult = {
  status: PropertyVerificationStatus;
  flags: VerificationFlag[];
  document: { id: string; status: string; flags: VerificationFlag[] } | null;
};

/** Ask the server to check a property (and a document just uploaded for it). */
export function verifyProperty(
  propertyId: string,
  documentId?: string,
): Promise<VerificationResult> {
  return invokeEdgeFunction<VerificationResult>("verify-property", {
    propertyId,
    ...(documentId ? { documentId } : {}),
  });
}

/** Fire-and-forget — a check that never runs leaves the property held, never approved. */
export function requestVerification(propertyId: string, documentId?: string): void {
  verifyProperty(propertyId, documentId)
    .then(() => {
      // same event as PROPERTIES_CHANGED_EVENT in properties.ts (not imported:
      // properties.ts imports this file)
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("corvuspt:properties-changed"));
    })
    .catch((err) => console.error("Property check couldn't start:", err));
}

/** Documents CorvusPT generates itself need no authenticity check. */
export function needsDocumentCheck(documentType: string | null | undefined): boolean {
  return !documentType || !GENERATED_DOCUMENT_TYPES.has(documentType);
}

export const VERIFICATION_LABEL: Record<PropertyVerificationStatus, string> = {
  pending: "Being checked",
  verified: "Verified",
  needs_review: "Under review",
  rejected: "Not accepted",
  test: "Test",
};

/** What the customer is told — the detailed reasons are for staff. */
export const VERIFICATION_CUSTOMER_TEXT: Record<PropertyVerificationStatus, string | null> = {
  pending:
    "We're checking this property against the county record. Filing opens once it's verified.",
  verified: null,
  needs_review:
    "Some details don't match the county record, so our team is reviewing them. You can keep working — filing opens once the review is done.",
  rejected: "We couldn't accept this property's documents. Please contact support.",
  test: "Test property — dummy documents are allowed on admin accounts only.",
};

/** Filing waits for the check (the database enforces this too). */
export function filingHold(status: PropertyVerificationStatus | null | undefined): string | null {
  if (!status || status === "verified" || status === "test") return null;
  return VERIFICATION_CUSTOMER_TEXT[status];
}

// --- Staff (Operations → Verification) -------------------------------------

export type VerificationQueueItem = {
  id: string;
  address: string;
  cad: string | null;
  accountNumber: string | null;
  ownerName: string | null;
  status: PropertyVerificationStatus;
  flags: VerificationFlag[];
  checkedAt: string | null;
  note: string | null;
  userEmail: string | null;
  documents: {
    id: string;
    fileName: string;
    storagePath: string;
    status: string | null;
    flags: VerificationFlag[];
  }[];
};

export async function listVerificationQueue(): Promise<VerificationQueueItem[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, address, cad, account_number, owner_name, user_id, verification_status, verification_flags, verification_checked_at, verification_note, documents(id, file_name, storage_path, verification_status, verification_flags, deleted_at)",
    )
    .in("verification_status", ["needs_review", "pending", "rejected"])
    .order("verification_checked_at", { ascending: false, nullsFirst: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] };
  const email = new Map(
    ((profiles ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]),
  );
  return rows.map((r) => ({
    id: r.id as string,
    address: r.address as string,
    cad: r.cad as string | null,
    accountNumber: r.account_number as string | null,
    ownerName: r.owner_name as string | null,
    status: r.verification_status as PropertyVerificationStatus,
    flags: (r.verification_flags as VerificationFlag[]) ?? [],
    checkedAt: r.verification_checked_at as string | null,
    note: r.verification_note as string | null,
    userEmail: email.get(r.user_id as string) ?? null,
    documents: ((r.documents as Array<Record<string, unknown>>) ?? [])
      .filter(
        (d) => !d.deleted_at && d.verification_status && d.verification_status !== "not_required",
      )
      .map((d) => ({
        id: d.id as string,
        fileName: d.file_name as string,
        storagePath: d.storage_path as string,
        status: d.verification_status as string | null,
        flags: (d.verification_flags as VerificationFlag[]) ?? [],
      })),
  }));
}

export async function reviewPropertyVerification(
  propertyId: string,
  decision: "verified" | "rejected",
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("review_property_verification", {
    p_property_id: propertyId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw error;
}
