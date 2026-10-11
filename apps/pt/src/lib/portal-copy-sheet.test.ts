import { describe, expect, it } from "vitest";
import { copySheet } from "./portal-copy-sheet";

// The shape of a real stored Notice of Protest (values changed).
const values = {
  "Appraisal Districts Name": "GUADALUPE APPRAISAL DISTRICT",
  "Appraisal District Account Number": "2G0138-0000-02200-0-00",
  "Tax Year": "2026",
  "Name of Property Owner or Lessee": "LONE STAR HOLDINGS LLC",
  "Mailing Address City State ZIP Code": "811 S CENTRAL EXPY STE 306 RICHARDSON, TX 75080",
  "Physical Address": "811 S CENTRAL EXPY STE 306 RICHARDSON, TX 75080",
  "Phone Number area code and number": "0000000000000",
  "Reason for protest 1": true,
  "Reason for protest 4": "true",
  "Reason for protest 5": false,
  "Appraisal districts value assigned to property": "572,865",
  "Print Name of Property Owner or Authorized Representative": ",",
  "Facts to resolve protest": "Income approach supports a lower value.",
};

describe("copySheet", () => {
  const rows = copySheet(values);
  const row = (label: string) => rows.find((r) => r.label === label)!;

  it("lays out what a county portal asks for, in order", () => {
    expect(rows[0]).toEqual({
      label: "Account number",
      value: "2G0138-0000-02200-0-00",
      warning: null,
    });
    expect(row("District's value").value).toBe("572,865");
  });

  it("names the checked reasons as worded on Form 50-132", () => {
    expect(row("Reasons for protest").value).toBe(
      "Incorrect appraised (market) value and/or value is unequal compared with other properties; Failure to send required notice",
    );
  });

  it("flags placeholder values before they're pasted into a portal", () => {
    expect(row("Phone").warning).toContain("placeholder");
    expect(row("Name of the person filing").warning).toContain("Looks empty");
    expect(row("Owner name").warning).toBeNull();
  });

  it("says when no reason is checked", () => {
    expect(copySheet({}).find((r) => r.label === "Reasons for protest")!.warning).toBe(
      "No reason is checked on the form.",
    );
  });
});
