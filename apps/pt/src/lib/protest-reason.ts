import { getDocumentUrl, type DocumentRecord } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import type { PropertyRecord } from "./properties";

// Real uploaded evidence documents in, real AI analysis out — see
// supabase/functions/draft-protest-reason/index.ts for the actual prompt/
// discipline. Two real callers: PdfFormEditor.tsx's "Generate Suggested
// Reason" button (draftProtestReason, below — just the suggested
// paragraph) and ai-report.tsx's Module 8 "Analyze My Evidence"
// (analyzeEvidence — the full per-document + summary analysis). Both are
// only ever triggered by an explicit user click, never automatic, and
// every field either returns is something the customer reviews — never
// inserted or submitted on its own.
//
// Reads from the same real "Protest Evidence"-tagged document list Module
// 8 (ai-report.tsx) writes to (see getProtestEvidenceDocuments in
// documents.ts) — not the older per-checklist-item links, since evidence
// upload now happens exclusively through Module 8.

const MAX_DOCS = 5;
// Stay well under Gemini's practical inline-data limits — a document over
// this is skipped (not sent, not guessed at), same "never fabricate"
// discipline as everything else this app sends to a model.
const MAX_BYTES_PER_DOC = 8 * 1024 * 1024;
// How many of the user's evidence documents to download and hash for exact-
// duplicate detection (see analyzeEvidence below) before capping to
// MAX_DOCS for the actual AI call — deliberately more generous than
// MAX_DOCS so a real duplicate among, say, 8 uploads doesn't just get
// silently left out of consideration because it landed past a 5-doc slice.
const MAX_DOCS_FOR_DEDUP = 20;

// arrayBuffer + btoa, not FileReader.readAsDataURL — works the same in the
// browser and in a plain Node test environment (no DOM), and this file
// already has the bytes in hand from fetch() rather than a <input> File.
function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export class NoEvidenceDocumentsError extends Error {
  constructor() {
    super("No evidence documents to read yet — upload some via Module 8 (Evidence) first.");
    this.name = "NoEvidenceDocumentsError";
  }
}

type PreparedDocument = { fileName: string; mimeType: string; bytes: Uint8Array };

// Downloads the real file bytes for up to `limit` evidence documents —
// shared by every caller below so there's exactly one real download/size-
// cap/skip-bad-file policy, not several that could drift. Returns raw bytes
// (not yet a data URL) so callers that only need to hash for duplicate
// detection (see analyzeEvidence below) aren't paying for a base64 encode
// they'll never use.
async function downloadEvidenceDocuments(
  evidenceDocuments: DocumentRecord[],
  limit: number,
): Promise<PreparedDocument[]> {
  const documents: PreparedDocument[] = [];
  for (const doc of evidenceDocuments.slice(0, limit)) {
    const url = await getDocumentUrl(doc.storagePath);
    const res = await fetch(url);
    if (!res.ok) continue; // one bad file shouldn't sink the whole analysis
    const blob = await res.blob();
    if (blob.size > MAX_BYTES_PER_DOC) continue;
    documents.push({
      fileName: doc.fileName,
      mimeType: blob.type || "application/octet-stream",
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  return documents;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// SHA-256 over the real file bytes — a byte-for-byte duplicate upload (the
// overwhelmingly common real case: the same PDF selected twice, or
// re-uploaded after a page reload) hashes identically every time, so this
// is a hard, verifiable "Duplicate" signal rather than an AI guess about
// whether two documents look similar. Web Crypto's subtle.digest is
// available in every browser and in Node 20+, so this works the same in
// tests as it does live.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

function propertyContext(property: PropertyRecord, strategyRecommendation: string | null) {
  return {
    address: property.address,
    cad: property.cad,
    taxYear: property.taxYear,
    totalValue: property.totalValue,
    strategyRecommendation,
  };
}

export async function draftProtestReason(
  property: PropertyRecord,
  strategyRecommendation: string | null,
  evidenceDocuments: DocumentRecord[],
): Promise<string> {
  if (evidenceDocuments.length === 0) throw new NoEvidenceDocumentsError();
  const prepared = await downloadEvidenceDocuments(evidenceDocuments, MAX_DOCS);
  if (prepared.length === 0) throw new NoEvidenceDocumentsError();

  const { text } = await invokeEdgeFunction<{ text: string }>("draft-protest-reason", {
    property: propertyContext(property, strategyRecommendation),
    documents: prepared.map((d) => ({
      fileName: d.fileName,
      mimeType: d.mimeType,
      dataUrl: bytesToDataUrl(d.bytes, d.mimeType),
    })),
  });
  return text;
}

// Every status Module 8 (Evidence) can show on an uploaded document.
// "Duplicate" is the one status this app assigns itself, deterministically
// (see the SHA-256 hash comparison in analyzeEvidence below) — the AI never
// sees or returns it, so it can never be faked by a document that merely
// looks similar to another.
export type DocumentStatus =
  | "Accepted"
  | "Needs Review"
  | "Incorrect Document"
  | "Duplicate"
  | "Additional Information Needed";

export type EvidenceAnalysis = {
  documentFindings: { fileName: string; status: DocumentStatus; assessment: string }[];
  summary: string;
  suggestedReason: string;
};

// The fuller version — real per-document findings (including an honest
// flag when a file doesn't look like real protest evidence at all) plus
// an overall summary, not just the one suggested paragraph
// draftProtestReason returns. Used by Module 8's "Analyze My Evidence" and
// its per-document status list / evidence-packet builder.
export async function analyzeEvidence(
  property: PropertyRecord,
  strategyRecommendation: string | null,
  evidenceDocuments: DocumentRecord[],
): Promise<EvidenceAnalysis> {
  if (evidenceDocuments.length === 0) throw new NoEvidenceDocumentsError();
  const prepared = await downloadEvidenceDocuments(evidenceDocuments, MAX_DOCS_FOR_DEDUP);
  if (prepared.length === 0) throw new NoEvidenceDocumentsError();

  // Exact-duplicate detection happens here, before anything reaches the AI —
  // real byte-for-byte hash matches, not a model's visual guess. The first
  // occurrence of a given hash is treated as the real document; every later
  // one is "Duplicate" and never sent to the AI at all.
  const hashes = await Promise.all(prepared.map((d) => sha256Hex(d.bytes)));
  const firstSeenAt = new Map<string, number>();
  const duplicateOf = new Map<number, number>(); // index -> index of the original
  hashes.forEach((hash, i) => {
    const seenAt = firstSeenAt.get(hash);
    if (seenAt == null) {
      firstSeenAt.set(hash, i);
    } else {
      duplicateOf.set(i, seenAt);
    }
  });

  const uniqueForAi = prepared
    .map((d, i) => ({ ...d, index: i }))
    .filter((d) => !duplicateOf.has(d.index))
    .slice(0, MAX_DOCS);

  // Exactly one AI call — its documentFindings feed the per-document list
  // below, and its summary/suggestedReason (grounded in these same unique
  // documents) are returned as-is.
  const aiResult: EvidenceAnalysis =
    uniqueForAi.length > 0
      ? await invokeEdgeFunction<EvidenceAnalysis>("draft-protest-reason", {
          property: propertyContext(property, strategyRecommendation),
          documents: uniqueForAi.map((d) => ({
            fileName: d.fileName,
            mimeType: d.mimeType,
            dataUrl: bytesToDataUrl(d.bytes, d.mimeType),
          })),
        })
      : { documentFindings: [], summary: "", suggestedReason: "" };
  // aiResult.documentFindings is returned in the same order as uniqueForAi
  // was sent (the edge function's own contract) — zip them back up by that
  // shared index.
  const aiFindingByIndex = new Map(
    uniqueForAi.map((d, i) => [d.index, aiResult.documentFindings[i]]),
  );

  const documentFindings = prepared.map((d, i) => {
    const original = duplicateOf.get(i);
    if (original != null) {
      return {
        fileName: d.fileName,
        status: "Duplicate" as const,
        assessment: `Identical to "${prepared[original].fileName}", already uploaded — excluded from the evidence packet.`,
      };
    }
    const found = aiFindingByIndex.get(i);
    // fileName always comes from the real record, not the AI's echoed copy
    // — the client already knows the true fileName, no need to trust the
    // model to have repeated it back correctly.
    return found
      ? { ...found, fileName: d.fileName }
      : {
          fileName: d.fileName,
          status: "Needs Review" as const,
          assessment: "Not analyzed — over the per-analysis document limit.",
        };
  });

  return { documentFindings, summary: aiResult.summary, suggestedReason: aiResult.suggestedReason };
}
