import { describe, it, expect } from "vitest";
import {
  isFormComplete,
  getIncompleteRequiredLabels,
  getFirstIncompleteFieldName,
  mmddyyyyToIso,
  NOTICE_OF_PROTEST_SCHEMA,
  APPOINTMENT_OF_AGENT_SCHEMA,
  EVIDENCE_DECLARATION_SCHEMA,
  getEvidenceDeclarationDefaults,
  getNoticeOfProtestDefaults,
  getAppointmentOfAgentDefaults,
  type FieldSection,
  type FieldValues,
} from "./protest-documents";
import type { PropertyRecord } from "./properties";
import type { AuthorizationRecord } from "./protest-authorizations";

describe("mmddyyyyToIso", () => {
  it("converts a real MM/DD/YYYY date to ISO for the native date picker", () => {
    expect(mmddyyyyToIso("01/05/2026")).toBe("2026-01-05");
    expect(mmddyyyyToIso("12/31/2026")).toBe("2026-12-31");
  });

  it("pads a single-digit month/day", () => {
    expect(mmddyyyyToIso("1/5/2026")).toBe("2026-01-05");
  });

  it("returns empty for blank, partial, or invalid input rather than guessing", () => {
    expect(mmddyyyyToIso("")).toBe("");
    expect(mmddyyyyToIso("not a date")).toBe("");
    expect(mmddyyyyToIso("13/40/2026")).toBe("");
  });
});

const simpleSchema: FieldSection[] = [
  {
    title: "Section A",
    fields: [
      { type: "text", name: "req_text", label: "Required Text", required: true },
      { type: "text", name: "opt_text", label: "Optional Text" },
      {
        type: "radio",
        name: "req_radio",
        label: "Required Choice",
        options: ["A", "B"],
        required: true,
      },
    ],
  },
  {
    title: "Section B",
    requireAtLeastOne: true,
    fields: [
      { type: "checkbox", name: "box1", label: "Box 1" },
      { type: "checkbox", name: "box2", label: "Box 2" },
    ],
  },
];

describe("isFormComplete / getIncompleteRequiredLabels", () => {
  it("is incomplete when a required text field is blank", () => {
    const values: FieldValues = { req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain("Required Text");
  });

  it("is incomplete when a required radio field is unanswered", () => {
    const values: FieldValues = { req_text: "hi", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain("Required Choice");
  });

  it("is incomplete when a requireAtLeastOne section has no checkbox checked", () => {
    const values: FieldValues = { req_text: "hi", req_radio: "A" };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain(
      "Section B — select at least one",
    );
  });

  it("getFirstIncompleteFieldName returns the real field name in schema order", () => {
    expect(getFirstIncompleteFieldName(simpleSchema, {})).toBe("req_text");
    expect(getFirstIncompleteFieldName(simpleSchema, { req_text: "hi" })).toBe("req_radio");
    expect(getFirstIncompleteFieldName(simpleSchema, { req_text: "hi", req_radio: "A" })).toBe(
      "box1",
    );
  });

  it("getFirstIncompleteFieldName returns null once the form is complete", () => {
    const values: FieldValues = { req_text: "hi", req_radio: "A", box1: true };
    expect(getFirstIncompleteFieldName(simpleSchema, values)).toBeNull();
  });

  it("never requires an optional field", () => {
    const values: FieldValues = { req_text: "hi", req_radio: "A", box2: true };
    expect(isFormComplete(simpleSchema, values)).toBe(true);
  });

  it("treats whitespace-only text as incomplete", () => {
    const values: FieldValues = { req_text: "   ", req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
  });

  it("is complete once every required field and group is satisfied", () => {
    const values: FieldValues = { req_text: "hi", opt_text: "", req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(true);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toEqual([]);
  });
});

describe("real schema completeness", () => {
  it("Notice of Protest is incomplete when blank", () => {
    expect(isFormComplete(NOTICE_OF_PROTEST_SCHEMA, {})).toBe(false);
  });

  it("Notice of Protest becomes complete once every real required field/group is filled", () => {
    const values: FieldValues = {
      "Appraisal Districts Name": "Collin Central Appraisal District",
      "Tax Year": "2026",
      "Name of Property Owner or Lessee": "Test Owner LLC",
      "Physical Address": "123 Main St, Plano, TX",
      "Reason for protest 1": true,
      "Certification and Signature": "Property Owner",
      "Print Name of Property Owner or Authorized Representative": "Jane Owner",
      "Date of Signature": "01/01/2026",
    };
    expect(isFormComplete(NOTICE_OF_PROTEST_SCHEMA, values)).toBe(true);
  });

  it("Appointment of Agent is incomplete when blank", () => {
    expect(isFormComplete(APPOINTMENT_OF_AGENT_SCHEMA, {})).toBe(false);
  });

  it("Appointment of Agent becomes complete once every real required field/group is filled", () => {
    const values: FieldValues = {
      "Appraisal District Name": "Collin Central Appraisal District",
      Name: "Test Owner LLC",
      "all property listed for me at the above address": true,
      Name_2: "Jane Agent",
      "all property tax matters concerning the property identified": true,
      "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):":
        "No",
      Date: "01/01/2026",
      "Name of Property Owner": "Jane Owner",
      "the property owner": true,
    };
    expect(isFormComplete(APPOINTMENT_OF_AGENT_SCHEMA, values)).toBe(true);
  });

  it("Evidence Declaration is incomplete when blank", () => {
    expect(isFormComplete(EVIDENCE_DECLARATION_SCHEMA, {})).toBe(false);
  });

  it("Evidence Declaration becomes complete once every real required field/group is filled", () => {
    const values: FieldValues = {
      "Appraisal Districts County Name": "Collin Central Appraisal District",
      "Tax Year": "2026",
      "Name of Property Owner or Lessee": "Test Owner LLC",
      "Sect2-1": "123 Main St, Plano, TX",
      "Reason for protest 1": true,
      "ARB hearing": "I intend to appear in person at the hearing.  ",
      "Texas County name": "Collin",
      "Affiant Name": "Jane Owner",
      "Affiant Name_2": "Jane Owner",
      "day of": "1",
      "Sig Month": "January",
      "Sig Year": "26",
    };
    expect(isFormComplete(EVIDENCE_DECLARATION_SCHEMA, values)).toBe(true);
  });
});

describe("getEvidenceDeclarationDefaults", () => {
  const property: PropertyRecord = {
    id: "prop-1",
    address: "123 Main St, Plano, TX 75023",
    cad: "Collin Central Appraisal District",
    accountNumber: "12345",
    ownerName: "Test Owner LLC",
    propertyType: "Commercial",
    landValue: 100000,
    improvementValue: 400000,
    totalValue: 500000,
    taxYear: 2026,
    protestDeadline: "2099-05-15",
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2026-01-01T00:00:00Z",
    valueHistory: null,
  };

  it("autofills the real property facts it knows", () => {
    const values = getEvidenceDeclarationDefaults(property, property.taxYear, 3);
    expect(values["Appraisal Districts County Name"]).toBe("Collin Central Appraisal District");
    expect(values.ADAN).toBe("12345");
    expect(values["Tax Year"]).toBe("2026");
    expect(values["Name of Property Owner or Lessee"]).toBe("Test Owner LLC");
    expect(values["Affiant Name"]).toBe("Test Owner LLC");
    expect(values["Affiant Name_2"]).toBe("Test Owner LLC");
  });

  it("fills both real evidence-count fields from the actual uploaded count", () => {
    const values = getEvidenceDeclarationDefaults(property, property.taxYear, 4);
    expect(values["Sect4-1"]).toBe("4");
    expect(values.sect7_4).toBe("4");
  });

  it("leaves the evidence-count fields blank rather than claiming 0 documents", () => {
    const values = getEvidenceDeclarationDefaults(property, property.taxYear, 0);
    expect(values["Sect4-1"]).toBe("");
    expect(values.sect7_4).toBe("");
  });

  it("defaults Date of Signature / Date to today, not blank", () => {
    // A required date field left blank by default meant every filer had to
    // manually click the "Today" suggestion chip (or type today's own date)
    // before the form would stop blocking Download/Continue — signing today
    // is the overwhelmingly common case, so this should already be filled.
    const today = new Date().toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });
    const noticeValues = getNoticeOfProtestDefaults(property, property.taxYear, null);
    expect(noticeValues["Date of Signature"]).toBe(today);

    const authorization: AuthorizationRecord = {
      id: "auth-1",
      protestId: null,
      propertyId: property.id,
      firstName: "Jamie",
      lastName: "Rivera",
      phone: "555-0100",
      isEntity: false,
      entityName: null,
      entityRelationship: null,
    };
    const agentValues = getAppointmentOfAgentDefaults(authorization, property);
    expect(agentValues.Date).toBe(today);
  });
});
