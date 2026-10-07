import { describe, expect, it } from "vitest";
import {
  addressKey,
  austinCaseToIssue,
  caseQuery,
  dallasCaseToIssue,
} from "../../../../supabase/pt/functions/_shared/city-code-cases";

describe("addressKey", () => {
  it("keys Austin and Dallas addresses", () => {
    expect(addressKey("7212 Vicenza Dr, Austin, TX 78652")).toEqual({
      city: "austin",
      houseNumber: "7212",
      streetPrefix: "VICENZA",
    });
    expect(addressKey("4316 S Malcolm X Blvd, Dallas, TX 75215")).toEqual({
      city: "dallas",
      houseNumber: "4316",
      streetPrefix: "S MALCOLM",
    });
  });
  it("skips other cities and unkeyable addresses", () => {
    expect(addressKey("601 Ridgecrest Rd, Forney TX 75126")).toBeNull();
    expect(addressKey("Bulverde Rd, Austin, TX 78259")).toBeNull();
    expect(addressKey("Austin Ave, Waco, TX")).toBeNull();
  });
});

describe("caseQuery", () => {
  it("builds escaped open-case filters", () => {
    const q = caseQuery(
      { city: "dallas", houseNumber: "12", streetPrefix: "O'CONNOR" },
      "2025-10-06",
    );
    expect(q.params.$where).toContain("starts_with(address, '12 O''CONNOR')");
    expect(q.params.$where).toContain("status != 'Closed'");
    const a = caseQuery(
      { city: "austin", houseNumber: "7212", streetPrefix: "VICENZA" },
      "2025-10-06",
    );
    expect(a.params.$where).toContain("house_number='7212'");
    expect(a.params.$where).toContain("closed_date IS NULL");
  });
});

describe("case → issue", () => {
  it("maps an Austin case with its inspector", () => {
    const i = austinCaseToIssue({
      case_id: "2026-130760 CC",
      status: "Pending",
      case_type: "Complaints",
      description: "Work Without Permit",
      inspector: "LaShondra Washington|(512) 552-8271",
      opened_date: "2026-10-05T00:00:00.000",
    });
    expect(i).toMatchObject({
      externalRef: "austin:2026-130760 CC",
      category: "code_offense",
      issuedOn: "2026-10-05",
    });
    expect(i?.authorityContact).toContain("Inspector LaShondra Washington · (512) 552-8271");
  });
  it("keeps Dallas property requests and drops unrelated 311 types", () => {
    expect(
      dallasCaseToIssue({
        service_request_number: "26-00438427",
        service_request_type: "Illegal Dumping Sign - CCS",
        created_date: "2026-10-04T01:14:44.000",
      }),
    ).toMatchObject({
      externalRef: "dallas:26-00438427",
      category: "dumping",
      title: "City of Dallas code request — Illegal Dumping Sign",
    });
    expect(
      dallasCaseToIssue({
        service_request_number: "1",
        service_request_type: "Restaurant/Food Complaint - CCS",
      }),
    ).toBeNull();
  });
});
