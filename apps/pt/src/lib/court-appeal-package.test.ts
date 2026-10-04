import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildAttorneyPackagePdf, winAnsiSafe } from "./court-appeal-package";

describe("winAnsiSafe", () => {
  it("swaps the symbols the app uses and drops what pdf-lib can't encode", () => {
    expect(winAnsiSafe("a → b ≈ c ✓ “q” …")).toBe('a -> b ~ c - "q" ...');
    expect(winAnsiSafe("smile 😀 ok")).toBe("smile  ok");
  });
});

describe("buildAttorneyPackagePdf", () => {
  it("builds a readable multi-page summary PDF", async () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({
      heading: `Section ${i + 1}`,
      lines: Array.from(
        { length: 12 },
        (_, k) =>
          `Line ${k} — a fairly long sentence about this case that has to wrap onto more than one line in the PDF ${"word ".repeat(20)}`,
      ),
    }));
    const bytes = await buildAttorneyPackagePdf({
      title: "Case Package for Attorney Review",
      subtitle: "6555 Dallas Pkwy → prepared today",
      sections,
      evidence: [],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("appends the evidence files behind the summary", async () => {
    const evidencePdf = await PDFDocument.create();
    evidencePdf.addPage([612, 792]);
    const evidenceBytes = await evidencePdf.save();
    const bytes = await buildAttorneyPackagePdf({
      title: "T",
      subtitle: "S",
      sections: [{ heading: "H", lines: ["one line"] }],
      evidence: [{ fileName: "comps.pdf", bytes: evidenceBytes.buffer as ArrayBuffer }],
    });
    const doc = await PDFDocument.load(bytes);
    // 1 summary page + (label page + the evidence page).
    expect(doc.getPageCount()).toBe(3);
  });
});
