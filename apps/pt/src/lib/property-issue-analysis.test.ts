import { describe, expect, it } from "vitest";
import {
  sanitizeIssueAnalysis,
  toAmount,
  toIsoDate,
} from "../../../../supabase/pt/functions/_shared/property-issue";

describe("toIsoDate", () => {
  it("accepts ISO and US dates", () => {
    expect(toIsoDate("2026-10-20")).toBe("2026-10-20");
    expect(toIsoDate("10/5/2026")).toBe("2026-10-05");
  });
  it("rejects impossible or vague dates", () => {
    expect(toIsoDate("02/30/2026")).toBeNull();
    expect(toIsoDate("within 10 days")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate("1890-01-01")).toBeNull();
  });
});

describe("toAmount", () => {
  it("parses money strings and numbers", () => {
    expect(toAmount("$1,250.00")).toBe(1250);
    expect(toAmount(200)).toBe(200);
  });
  it("drops zero, negative and junk", () => {
    expect(toAmount(0)).toBeNull();
    expect(toAmount("-5")).toBeNull();
    expect(toAmount("unknown")).toBeNull();
  });
});

describe("sanitizeIssueAnalysis", () => {
  it("clamps the model's output to safe fields", () => {
    const out = sanitizeIssueAnalysis({
      fields: {
        category: "grass",
        title: "High grass and weeds",
        deadline: "10/20/2026",
        fineAmount: "$250",
        authority: "City of Dallas Code Compliance",
        courtDate: "not specified",
        consequences: "null",
      },
      guidance: {
        whatHappened: "The city cited tall grass.",
        whatToDo: "Mow below 12 inches.",
        byWhen: "October 20, 2026",
        ifNotResolved: "The city may mow and bill you.",
        nextSteps: ["Mow", "", "Take dated photos", 7],
        whoToHire: "Lawn care service",
      },
    });
    expect(out.fields).toMatchObject({
      category: "grass",
      deadline: "2026-10-20",
      fineAmount: 250,
      courtDate: null,
      consequences: null,
    });
    expect(out.guidance?.nextSteps).toEqual(["Mow", "Take dated photos"]);
  });

  it("falls back to 'other' and a default title, and drops empty guidance", () => {
    const out = sanitizeIssueAnalysis({ fields: { category: "parking" }, guidance: {} });
    expect(out.fields.category).toBe("other");
    expect(out.fields.title).toBe("Property notice");
    expect(out.guidance).toBeNull();
  });
});
