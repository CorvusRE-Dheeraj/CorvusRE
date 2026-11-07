import { describe, expect, it } from "vitest";
import {
  addressLines,
  countyCodeFor,
  letterPdf,
  letterText,
  mailtoHref,
  methodOptions,
  phoneScriptText,
  suggestedMethod,
  telHref,
  type DistrictContact,
  type WithdrawalRules,
} from "./protest-withdrawal";

const contact: DistrictContact = {
  name: "Bexar Appraisal District",
  phone: "210-224-2432",
  email: "info@bcad.org",
  website: "https://bcad.org",
  mailingAddress: "P.O. Box 830248, San Antonio, TX 78283-0248",
  streetAddress: "411 N. Frio St., San Antonio, TX 78207",
};

const rules = (over: Partial<WithdrawalRules> = {}): WithdrawalRules => ({
  withdrawalDiscussed: true,
  summary: "Send a signed written withdrawal.",
  email: { accepted: null, address: null, notes: null },
  letter: { accepted: null, notes: null },
  phone: { accepted: null, number: null, notes: null },
  online: { accepted: null, url: null, notes: null },
  form: { name: null, url: null, required: null },
  steps: [],
  deadline: null,
  otherRequirements: [],
  sourceUrls: [],
  retrievedAt: "2026-11-06T00:00:00Z",
  ...over,
});

describe("methodOptions", () => {
  it("uses the county's own withdrawal email/phone over the directory's general ones", () => {
    const o = methodOptions(
      rules({
        email: {
          accepted: true,
          address: "protest@bcad.org",
          notes: "Include the account number.",
        },
        phone: { accepted: false, number: null, notes: null },
      }),
      contact,
    );
    expect(o.find((x) => x.method === "email")).toMatchObject({
      status: "accepted",
      target: "protest@bcad.org",
      note: "Include the account number.",
    });
    expect(o.find((x) => x.method === "phone")).toMatchObject({
      status: "not_accepted",
      target: "210-224-2432",
    });
    expect(o.find((x) => x.method === "letter")?.target).toBe(contact.mailingAddress);
  });

  it("marks every method unstated when the site couldn't be read", () => {
    const o = methodOptions(null, contact);
    expect(o.map((x) => x.status)).toEqual(["unstated", "unstated", "unstated"]);
    expect(o[0].target).toBe("info@bcad.org");
  });
});

describe("suggestedMethod", () => {
  it("prefers a method the county accepts", () => {
    const o = methodOptions(
      rules({ phone: { accepted: true, number: null, notes: null } }),
      contact,
    );
    expect(suggestedMethod(o)).toBe("phone");
  });
  it("prefers email over a letter when nothing is stated", () => {
    expect(suggestedMethod(methodOptions(null, contact))).toBe("email");
  });
  it("never suggests a method the county refuses", () => {
    const o = methodOptions(
      rules({ email: { accepted: false, address: null, notes: null } }),
      contact,
    );
    expect(suggestedMethod(o)).toBe("letter");
  });
});

describe("links", () => {
  it("builds a mailto with the subject and body encoded", () => {
    expect(mailtoHref("a@b.org", "Withdraw & confirm", "Line 1\nLine 2")).toBe(
      "mailto:a%40b.org?subject=Withdraw%20%26%20confirm&body=Line%201%0ALine%202",
    );
  });
  it("builds a tel link from a formatted number", () => {
    expect(telHref("(210) 224-2432")).toBe("tel:2102242432");
  });
});

describe("letter", () => {
  it("splits a directory address into street and city lines", () => {
    expect(addressLines(contact.mailingAddress)).toEqual([
      "P.O. Box 830248",
      "San Antonio, TX 78283-0248",
    ]);
    expect(addressLines(null)).toEqual([]);
  });

  it("wraps the AI body with date, addressee, RE line and signature block", () => {
    const t = letterText({
      contact,
      subject: "Withdrawal of Protest — Account 1149803, Tax Year 2026",
      body: "Dear Appraisal Review Board,\n\nI withdraw my protest.\n\nSincerely,",
      facts: {
        ownerName: "Zz Import",
        ownerPhone: null,
        ownerEmail: "qa-customer@corvustest.dev",
        accountNumber: "1149803",
        address: "19730 Bulverde Rd",
        taxYear: 2026,
      },
      date: "November 6, 2026",
    });
    expect(t.split("\n").slice(0, 8)).toEqual([
      "November 6, 2026",
      "",
      "Appraisal Review Board",
      "Bexar Appraisal District",
      "P.O. Box 830248",
      "San Antonio, TX 78283-0248",
      "",
      "RE: Withdrawal of Protest — Account 1149803, Tax Year 2026",
    ]);
    expect(t).toMatch(/Sincerely,\n\n\n_+\nZz Import\nqa-customer@corvustest\.dev$/);
  });

  it("renders a PDF even with characters the standard font can't encode", async () => {
    const bytes = await letterPdf("Dear Board — “quoted” • item… ✓\n\nSincerely,");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

describe("phone script", () => {
  it("lays out opening, points, questions and closing", () => {
    const s = phoneScriptText({
      opening: "Hi, I'm calling to withdraw a protest.",
      points: ["Account 1149803"],
      ask: ["Do I need to send it in writing?"],
      closing: "Thank you.",
    });
    expect(s).toContain("When they answer:\nHi, I'm calling to withdraw a protest.");
    expect(s).toContain("• Account 1149803");
    expect(s).toContain("Ask:\n• Do I need to send it in writing?");
  });
});

it("maps a property's CAD to its Comptroller county code", () => {
  expect(countyCodeFor("Harris Central Appraisal District")).toBe("101");
  expect(countyCodeFor("Nowhere")).toBeNull();
});
