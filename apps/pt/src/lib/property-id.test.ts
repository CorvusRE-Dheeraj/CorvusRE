import { describe, expect, it } from "vitest";
import { looksLikePropertyId } from "../../../../supabase/pt/functions/_shared/property-id";

describe("looksLikePropertyId", () => {
  it("recognizes Property IDs and Geographic IDs / account numbers", () => {
    for (const id of [
      "34086",
      "1151895",
      "A1246A-000-0023-0000",
      "0174230307",
      "R123456",
      "00.3040.0000.0011.00.06.12",
    ]) {
      expect(looksLikePropertyId(id)).toBe(true);
    }
  });
  it("leaves addresses, names and short text to the address search", () => {
    for (const text of ["900 willowwood", "Walmart Denton", "Smith", "123", "75205 Main", "I35"]) {
      expect(looksLikePropertyId(text)).toBe(false);
    }
  });
});
