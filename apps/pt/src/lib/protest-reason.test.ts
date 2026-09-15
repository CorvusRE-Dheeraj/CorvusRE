import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PropertyRecord } from "./properties";
import type { DocumentRecord } from "./documents";

vi.mock("./documents", () => ({
  getDocumentUrl: vi.fn(async (path: string) => `https://signed.example/${path}`),
}));
vi.mock("./edge-functions", () => ({
  invokeEdgeFunction: vi.fn(async () => ({
    text: "Suggested reason text.",
    suggestedReason: "Suggested reason text.",
    summary: "Overall summary.",
    documentFindings: [
      { fileName: "rent-roll.pdf", status: "Accepted", assessment: "Shows real occupancy data." },
    ],
  })),
}));

import { getDocumentUrl } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { draftProtestReason, analyzeEvidence, NoEvidenceDocumentsError } from "./protest-reason";

const property: PropertyRecord = {
  id: "prop-1",
  address: "123 Main St, Plano, TX 75023",
  cad: "Collin Central Appraisal District",
  accountNumber: "12345",
  ownerName: "Test Owner LLC",
  propertyType: "Commercial",
  landValue: 100000,
  improvementValue: 400000,
  totalValue: 500000,
  taxYear: 2026,
  protestDeadline: "2099-05-15",
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings: null,
  savingsBasis: null,
  createdAt: "2026-01-01T00:00:00Z",
  valueHistory: null,
};

function doc(overrides: Partial<DocumentRecord>): DocumentRecord {
  return {
    id: "d1",
    propertyId: "prop-1",
    fileName: "rent-roll.pdf",
    storagePath: "u/p/rr.pdf",
    documentType: "Protest Evidence",
    uploadedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockFetchOk(bytes = new Uint8Array([1, 2, 3]), type = "application/pdf") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: async () => ({
        size: bytes.length,
        type,
        arrayBuffer: async () => bytes.buffer,
      }),
    })),
  );
}

// Real per-document content, keyed by the same signed URL getDocumentUrl's
// mock returns (https://signed.example/<storagePath>) — lets a duplicate-
// detection test give two documents genuinely identical bytes while a third
// gets different ones, which a single shared mockFetchOk() can't express.
function mockFetchByPath(byPath: Record<string, { bytes: Uint8Array; type?: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace("https://signed.example/", "");
      const entry = byPath[path];
      if (!entry) return { ok: false };
      return {
        ok: true,
        blob: async () => ({
          size: entry.bytes.length,
          type: entry.type ?? "application/pdf",
          arrayBuffer: async () => entry.bytes.buffer,
        }),
      };
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("draftProtestReason", () => {
  it("throws NoEvidenceDocumentsError when there are no documents at all", async () => {
    await expect(draftProtestReason(property, null, [])).rejects.toThrow(NoEvidenceDocumentsError);
  });

  it("throws NoEvidenceDocumentsError when every document fails to download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(draftProtestReason(property, null, [doc({})])).rejects.toThrow(
      NoEvidenceDocumentsError,
    );
  });

  it("downloads real document bytes via getDocumentUrl and calls the edge function", async () => {
    mockFetchOk();
    const result = await draftProtestReason(property, "Market Value", [doc({})]);

    expect(result).toBe("Suggested reason text.");
    expect(getDocumentUrl).toHaveBeenCalledWith("u/p/rr.pdf");
    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "draft-protest-reason",
      expect.objectContaining({
        property: expect.objectContaining({
          address: property.address,
          cad: property.cad,
          strategyRecommendation: "Market Value",
        }),
        documents: [
          expect.objectContaining({ fileName: "rent-roll.pdf", mimeType: "application/pdf" }),
        ],
      }),
    );
  });

  it("skips a document over the size cap rather than sending or guessing at it", async () => {
    const big = new Uint8Array(9 * 1024 * 1024); // over the 8MB cap
    mockFetchOk(big);
    await expect(
      draftProtestReason(property, null, [doc({ fileName: "huge.pdf" })]),
    ).rejects.toThrow(NoEvidenceDocumentsError);
  });

  it("sends up to 5 documents, not more", async () => {
    mockFetchOk();
    const documents = Array.from({ length: 8 }, (_, i) =>
      doc({ id: `d${i}`, fileName: `f${i}.pdf`, storagePath: `u/p/f${i}.pdf` }),
    );
    await draftProtestReason(property, null, documents);
    const call = vi.mocked(invokeEdgeFunction).mock.calls[0][1] as { documents: unknown[] };
    expect(call.documents).toHaveLength(5);
  });
});

describe("analyzeEvidence", () => {
  it("throws NoEvidenceDocumentsError when there are no documents at all", async () => {
    await expect(analyzeEvidence(property, null, [])).rejects.toThrow(NoEvidenceDocumentsError);
  });

  it("returns the full structured analysis, not just the suggested paragraph", async () => {
    mockFetchOk();
    const result = await analyzeEvidence(property, "Market Value", [doc({})]);

    expect(result.summary).toBe("Overall summary.");
    expect(result.suggestedReason).toBe("Suggested reason text.");
    expect(result.documentFindings).toEqual([
      { fileName: "rent-roll.pdf", status: "Accepted", assessment: "Shows real occupancy data." },
    ]);
  });

  it("shares the same real download/size-cap policy as draftProtestReason", async () => {
    const big = new Uint8Array(9 * 1024 * 1024);
    mockFetchOk(big);
    await expect(analyzeEvidence(property, null, [doc({ fileName: "huge.pdf" })])).rejects.toThrow(
      NoEvidenceDocumentsError,
    );
  });

  it("flags a byte-identical re-upload as Duplicate without asking the AI", async () => {
    mockFetchByPath({
      "u/p/a.pdf": { bytes: new Uint8Array([1, 2, 3]) },
      "u/p/b.pdf": { bytes: new Uint8Array([1, 2, 3]) }, // identical content
    });
    const result = await analyzeEvidence(property, null, [
      doc({ id: "a", fileName: "a.pdf", storagePath: "u/p/a.pdf" }),
      doc({ id: "b", fileName: "b.pdf", storagePath: "u/p/b.pdf" }),
    ]);

    // Only the first (unique) document is ever sent to the AI.
    const call = vi.mocked(invokeEdgeFunction).mock.calls[0][1] as { documents: unknown[] };
    expect(call.documents).toHaveLength(1);

    expect(result.documentFindings).toEqual([
      { fileName: "a.pdf", status: "Accepted", assessment: "Shows real occupancy data." },
      {
        fileName: "b.pdf",
        status: "Duplicate",
        assessment: 'Identical to "a.pdf", already uploaded — excluded from the evidence packet.',
      },
    ]);
  });

  it("does not flag two different documents as duplicates", async () => {
    mockFetchByPath({
      "u/p/a.pdf": { bytes: new Uint8Array([1, 2, 3]) },
      "u/p/b.pdf": { bytes: new Uint8Array([4, 5, 6]) },
    });
    await analyzeEvidence(property, null, [
      doc({ id: "a", fileName: "a.pdf", storagePath: "u/p/a.pdf" }),
      doc({ id: "b", fileName: "b.pdf", storagePath: "u/p/b.pdf" }),
    ]);

    const call = vi.mocked(invokeEdgeFunction).mock.calls[0][1] as { documents: unknown[] };
    expect(call.documents).toHaveLength(2);
  });
});
