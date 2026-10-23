import { describe, expect, it } from "vitest";
import { formatBytes, surveyFileProblem, surveyMime } from "./design-survey";

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("land survey files", () => {
  it("accepts PNG, JPG/JPEG and PDF — by type, or by extension when the browser leaves type empty", () => {
    expect(surveyMime(f("plat.png", "image/png"))).toBe("image/png");
    expect(surveyMime(f("plat.JPG", ""))).toBe("image/jpeg");
    expect(surveyMime(f("plat.jpeg", ""))).toBe("image/jpeg");
    expect(surveyMime(f("Survey 2026.PDF", ""))).toBe("application/pdf");
    expect(surveyMime(f("plat.dwg", ""))).toBeNull();
    expect(surveyMime(f("plat.heic", "image/heic"))).toBeNull();
  });
  it("explains why a file can't be used", () => {
    expect(surveyFileProblem(f("plat.pdf", "application/pdf"))).toBeNull();
    expect(surveyFileProblem(f("plat.docx", ""))).toMatch(/PNG, JPG\/JPEG or PDF/);
    expect(surveyFileProblem(f("plat.pdf", "application/pdf", 0))).toMatch(/empty/);
    expect(surveyFileProblem(f("plat.pdf", "application/pdf", 16 * 1024 * 1024))).toMatch(
      /16\.0 MB — the limit is 15 MB/,
    );
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
