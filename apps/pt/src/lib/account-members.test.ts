import { describe, expect, it } from "vitest";
import { memberCan, ROLE_LABEL, ROLE_SUMMARY } from "./account-members";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const ws = (role: "property_manager" | "cpa") => ({
  ownerId: "o",
  ownerName: "Lone Star Holdings",
  role,
  propertyIds: null,
});

describe("memberCan", () => {
  it("lets the owner do everything in their own account", () => {
    expect(memberCan(null, "write")).toBe(true);
    expect(memberCan(null, "billing")).toBe(true);
  });

  it("lets a property manager work cases but not billing or settings", () => {
    expect(memberCan(ws("property_manager"), "write")).toBe(true);
    expect(memberCan(ws("property_manager"), "billing")).toBe(false);
    expect(memberCan(ws("property_manager"), "settings")).toBe(false);
  });

  it("keeps a CPA read-only", () => {
    expect(memberCan(ws("cpa"), "write")).toBe(false);
    expect(memberCan(ws("cpa"), "billing")).toBe(false);
  });

  it("describes each role plainly", () => {
    expect(ROLE_LABEL.cpa).toBe("CPA / controller");
    expect(Object.values(ROLE_SUMMARY).flatMap(directivePhrases)).toEqual([]);
  });
});
