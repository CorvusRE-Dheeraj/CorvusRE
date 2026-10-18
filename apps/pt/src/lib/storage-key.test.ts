import { describe, expect, it } from "vitest";
import { storageSafeName } from "./storage-key";

describe("storageSafeName", () => {
  it("keeps plain names and makes awkward ones storage-safe", () => {
    expect(storageSafeName("Appraisal Notice 2026.pdf")).toBe("Appraisal-Notice-2026.pdf");
    expect(storageSafeName("Notice (2026) – final.pdf")).toBe("Notice-2026-final.pdf");
    expect(storageSafeName("Café façade.JPG")).toBe("Cafe-facade.JPG");
    expect(storageSafeName("Evidence 50% value.pdf")).toBe("Evidence-50-value.pdf");
    expect(storageSafeName("a[1].pdf")).toBe("a-1.pdf");
    expect(storageSafeName("税务通知.pdf")).toBe("file.pdf");
    expect(storageSafeName("no-extension")).toBe("no-extension");
  });
});
