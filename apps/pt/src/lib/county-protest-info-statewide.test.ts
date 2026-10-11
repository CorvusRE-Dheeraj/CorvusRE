import { describe, expect, it, vi } from "vitest";

// loadCountyProcedures calls the retrieve-county-procedures edge function.
const invoke = vi.fn();
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));

const { getCountyProtestInfo } = await import("./county-protest-info");
const { lookupCadDirectory } = await import("./cad-directory");
const { loadCountyProcedures } = await import("./county-procedures");

describe("statewide county coverage", () => {
  it("still prefers the hand-researched entry", () => {
    expect(getCountyProtestInfo("Tarrant Appraisal District")?.basis).toBeUndefined();
  });

  it("covers a county with no researched entry from the Comptroller's directory", () => {
    const info = getCountyProtestInfo("Hays Central Appraisal District")!;
    expect(info.basis).toBe("directory");
    expect(info.filingMethod.mail?.address).toMatch(/TX/);
    expect(info.filingMethod.online).toBeNull(); // never guessed from the directory
    expect(info.filingMethod.email.available).toBeNull();
    expect(info.sourceUrl).toBe(
      "https://comptroller.texas.gov/taxes/property-tax/county-directory/hays.php",
    );
  });

  it("finds every one of the 254 counties by name", () => {
    expect(lookupCadDirectory("Loving County Appraisal District")?.county).toBe("Loving");
    expect(
      lookupCadDirectory("Fort Bend Central Appraisal District")?.appraisalDistrict?.name,
    ).toBe("Fort Bend Appraisal District");
    expect(lookupCadDirectory("Atlantis Appraisal District")).toBeNull();
  });

  it("layers what AI read off the district's site on top, once loaded", async () => {
    invoke.mockResolvedValueOnce({
      procedures: {
        onlinePortalUrl: "https://hayscad.com/eFile/",
        onlineNotes: "Use the PIN on your notice.",
        emailFilingAvailable: null,
        emailFilingAddress: null,
        emailNotes: null,
        informalReviewHowTo: "Request an informal meeting through the online portal.",
        informalReviewNotes: null,
        arbPhone: "512-268-2522",
        arbEmail: null,
        sourceUrls: ["https://hayscad.com/protests/"],
        retrievedAt: "2026-10-06T12:00:00Z",
      },
    });
    await loadCountyProcedures("Hays Central Appraisal District");
    const info = getCountyProtestInfo("Hays Central Appraisal District")!;
    expect(info.basis).toBe("ai_retrieved");
    expect(info.filingMethod.online?.url).toBe("https://hayscad.com/eFile/");
    expect(info.filingMethod.online?.notes).toMatch(/Read by AI from the district's website/);
    expect(info.filingMethod.mail?.address).toMatch(/TX/); // directory facts kept
    expect(info.arbContact?.phone).toBe("512-268-2522");
    expect(info.sourceUrl).toBe("https://hayscad.com/protests/");
  });
});
