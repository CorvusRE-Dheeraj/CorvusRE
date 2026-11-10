import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import {
  TRACKING_ID_RE,
  newTrackingId,
  normalizeTrackingId,
  stampTrackingId,
  verifyUrl,
} from "./signing-packets";

describe("signing packet IDs", () => {
  it("makes CPT-XXXX-XXXX IDs from the Crockford alphabet (the database accepts the same shape)", () => {
    const ids = new Set(Array.from({ length: 500 }, newTrackingId));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(TRACKING_ID_RE);
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  it("reads an ID however it's typed", () => {
    expect(normalizeTrackingId("cpt-7f3k-9q2m")).toBe("CPT-7F3K-9Q2M");
    expect(normalizeTrackingId(" CPT 7F3K 9Q2M ")).toBe("CPT-7F3K-9Q2M");
    expect(normalizeTrackingId("7F3K9Q2M")).toBe("CPT-7F3K-9Q2M");
    expect(normalizeTrackingId("CPT-7F3K-9Q2")).toBeNull(); // too short
    expect(normalizeTrackingId("CPT-7F3K-9Q2I")).toBeNull(); // I isn't used
    expect(normalizeTrackingId("hello")).toBeNull();
  });

  it("links to the verify page with the ID", () => {
    expect(verifyUrl("CPT-7F3K-9Q2M")).toMatch(/\/verify\?id=CPT-7F3K-9Q2M$/);
  });

  it("prints the ID on every page of a PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    await stampTrackingId(doc, "CPT-7F3K-9Q2M");
    const stamped = draw.mock.calls.filter(([t]) =>
      String(t).startsWith("CorvusPT signing packet CPT-7F3K-9Q2M"),
    );
    expect(stamped).toHaveLength(2);
    draw.mockRestore();
  });
});
