import { getDocumentUrl, type DocumentRecord } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import type { PropertyRecord } from "./properties";

// Real uploaded proof-of-filing documents in, a real AI read of what's
// actually visible out — see verify-filing-proof/index.ts for the prompt/
// discipline. Only ever triggered by the customer's own explicit "Yes —
// Protest Filed" click (see CaseDetailModal.tsx) and never blocks or
// auto-confirms anything itself; it's a flag for the customer to notice
// before THEY confirm, not a gate this app enforces on its own.

const MAX_DOCS = 5;
const MAX_BYTES_PER_DOC = 8 * 1024 * 1024;

export type FilingProofFinding = {
  fileName: string;
  hasVisibleSignature: boolean;
  signatureNameObserved: string | null;
  dateObserved: string | null;
  dateYearPlausible: boolean | null;
  notes: string;
};

export type FilingProofVerification = {
  findings: FilingProofFinding[];
  overallAssessment: string;
};

export class NoProofDocumentsError extends Error {
  constructor() {
    super("No proof-of-filing documents to check yet — upload at least one first.");
    this.name = "NoProofDocumentsError";
  }
}

export async function verifyFilingProof(
  property: PropertyRecord,
  proofDocuments: DocumentRecord[],
): Promise<FilingProofVerification> {
  if (proofDocuments.length === 0) throw new NoProofDocumentsError();

  const documents: { fileName: string; mimeType: string; dataUrl: string }[] = [];
  for (const doc of proofDocuments.slice(0, MAX_DOCS)) {
    const url = await getDocumentUrl(doc.storagePath);
    const res = await fetch(url);
    if (!res.ok) continue; // one bad file shouldn't sink the whole check
    const blob = await res.blob();
    if (blob.size > MAX_BYTES_PER_DOC) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = blob.type || "application/octet-stream";
    documents.push({
      fileName: doc.fileName,
      mimeType,
      dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    });
  }
  if (documents.length === 0) throw new NoProofDocumentsError();

  return invokeEdgeFunction<FilingProofVerification>("verify-filing-proof", {
    property: {
      address: property.address,
      cad: property.cad,
      taxYear: property.taxYear,
      ownerName: property.ownerName,
    },
    documents,
  });
}
