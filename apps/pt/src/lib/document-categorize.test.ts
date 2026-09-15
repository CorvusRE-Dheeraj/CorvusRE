import { describe, it, expect } from "vitest";
import { matchPropertyForExtraction } from "./document-categorize";
import type { Extraction } from "./document-ai";
import type { PropertyRecord } from "./properties";

function extraction(overrides: Partial<Extraction>): Extraction {
  return {
    documentType: "Real Property Appraisal Notice",
    ownerName: null,
    propertyName: null,
    propertyAddress: null,
    situsAddress: null,
    county: null,
    cadName: null,
    accountNumber: null,
    parcelId: null,
    taxYear: null,
    noticeValue: null,
    landValue: null,
    improvementValue: null,
    bppValue: null,
    priorValue: null,
    noticeDate: null,
    mailDate: null,
    protestDeadline: null,
    hearingDate: null,
    hearingTime: null,
    hearingInstructions: null,
    paymentDueDate: null,
    taxAmountDue: null,
    taxableValue: null,
    taxRate: null,
    penaltyDate: null,
    refundAmount: null,
    pinOrEpin: null,
    exemptions: null,
    confidence: 0.9,
    reasoning: null,
    ...overrides,
  };
}

function property(overrides: Partial<PropertyRecord>): PropertyRecord {
  return {
    id: "p1",
    address: "123 Main St, Plano, TX 75023",
    cad: "Collin Central Appraisal District",
    accountNumber: "12345",
    ownerName: null,
    propertyType: "Commercial",
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: null,
    protestDeadline: null,
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2026-01-01T00:00:00Z",
    valueHistory: null,
    ...overrides,
  };
}

describe("matchPropertyForExtraction", () => {
  it("matches by exact account number", () => {
    const properties = [property({ id: "p1", accountNumber: "12345" })];
    const result = matchPropertyForExtraction(extraction({ accountNumber: "12345" }), properties);
    expect(result?.id).toBe("p1");
  });

  it("matches by normalized address when account number doesn't match", () => {
    const properties = [property({ id: "p1", address: "123 Main St, Plano, TX 75023" })];
    const result = matchPropertyForExtraction(
      extraction({ propertyAddress: "123 MAIN ST., Plano, TX 75023" }),
      properties,
    );
    expect(result?.id).toBe("p1");
  });

  it("falls back to situsAddress when propertyAddress is missing", () => {
    const properties = [property({ id: "p1", address: "123 Main St, Plano, TX 75023" })];
    const result = matchPropertyForExtraction(
      extraction({ situsAddress: "123 Main St, Plano, TX 75023" }),
      properties,
    );
    expect(result?.id).toBe("p1");
  });

  it("returns null when the account number matches more than one property", () => {
    const properties = [
      property({ id: "p1", accountNumber: "999" }),
      property({ id: "p2", accountNumber: "999" }),
    ];
    const result = matchPropertyForExtraction(extraction({ accountNumber: "999" }), properties);
    expect(result).toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    const properties = [property({ id: "p1", accountNumber: "12345" })];
    const result = matchPropertyForExtraction(
      extraction({ accountNumber: "99999", propertyAddress: "999 Nowhere Ave" }),
      properties,
    );
    expect(result).toBeNull();
  });

  it("returns null when the extraction has no account number or address at all", () => {
    const properties = [property({ id: "p1" })];
    const result = matchPropertyForExtraction(extraction({}), properties);
    expect(result).toBeNull();
  });
});
