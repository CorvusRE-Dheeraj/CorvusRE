import { describe, expect, it } from "vitest";
import {
  ARB_DECISION_CATEGORIES,
  SETTLEMENT_CATEGORIES,
  documentMismatch,
} from "./decision-notice";

const prop = { accountNumber: "1313473" };

describe("documentMismatch", () => {
  it("accepts the right document for the right property", () => {
    expect(
      documentMismatch(
        { documentCategory: "Settlement", accountNumber: "01313473" },
        prop,
        SETTLEMENT_CATEGORIES,
        "a signed settlement agreement",
      ),
    ).toBeNull();
  });
  it("rejects an unrelated file", () => {
    expect(
      documentMismatch(
        { documentCategory: "Other", accountNumber: null },
        prop,
        SETTLEMENT_CATEGORIES,
        "a signed settlement agreement",
      ),
    ).toMatch(/doesn't look like a signed settlement agreement/);
  });
  it("points an ARB order to the Formal Hearing tab", () => {
    expect(
      documentMismatch(
        { documentCategory: "ARB Order", accountNumber: null },
        prop,
        SETTLEMENT_CATEGORIES,
        "a signed settlement agreement",
      ),
    ).toMatch(/Formal Hearing tab/);
  });
  it("points a settlement to the Informal Review tab", () => {
    expect(
      documentMismatch(
        { documentCategory: "Settlement", accountNumber: null },
        prop,
        ARB_DECISION_CATEGORIES,
        "an ARB order or hearing decision",
      ),
    ).toMatch(/Informal Review tab/);
  });
  it("rejects another property's document", () => {
    expect(
      documentMismatch(
        { documentCategory: "Settlement", accountNumber: "2544202" },
        prop,
        SETTLEMENT_CATEGORIES,
        "a signed settlement agreement",
      ),
    ).toMatch(/account 2544202/);
  });
  it("doesn't block when the account wasn't read", () => {
    expect(
      documentMismatch(
        { documentCategory: "Settlement", accountNumber: null },
        prop,
        SETTLEMENT_CATEGORIES,
        "a signed settlement agreement",
      ),
    ).toBeNull();
  });
});
