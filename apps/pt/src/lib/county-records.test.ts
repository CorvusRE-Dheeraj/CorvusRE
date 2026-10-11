import { describe, expect, it } from "vitest";
import {
  isoDate,
  parseHarrisHearing,
  parseHarrisProtest,
  planCaseUpdate,
  type CaseFields,
  type CountyRecord,
} from "../../../../supabase/pt/functions/_shared/county-records";

const HEADER =
  "acct\tTax_Year\tReal_Personal_Property\tHearing_Type\tState_Class_Code\tOwner_Name\tScheduled_for_Date\tActual_Hearing_Date\tRelease_Date\tLetter_Type\tAgent_Code\tInitial_Appraised_Value\tInitial_Market_Value\tFinal_Appraised_Value\tFinal_Market_Value".split(
    "\t",
  );
const CAD = "Harris Central Appraisal District";
const fresh: CaseFields = {
  status: "requested",
  hearing_date: null,
  hearing_completed_at: null,
  final_value: null,
  arb_decision_date: null,
};
const rec = (x: Partial<CountyRecord>): CountyRecord => ({
  account: "1350510010006",
  taxYear: 2025,
  protestedAt: null,
  protestedBy: null,
  scheduledHearing: null,
  actualHearing: null,
  releaseDate: null,
  stage: "formal",
  initialValue: null,
  finalValue: null,
  withdrawn: false,
  ...x,
});

describe("parsing Harris CAD's files", () => {
  it("reads the protest and hearing rows", () => {
    expect(isoDate("04/29/2025")).toBe("2025-04-29");
    expect(isoDate("")).toBeNull();
    expect(parseHarrisProtest("1350510010006\tAgent\t04/29/2025")).toEqual({
      account: "1350510010006",
      protestedBy: "agent",
      protestedAt: "2025-04-29",
    });
    expect(parseHarrisProtest("acct\tprotested_by\tprotested_dt")).toBeNull();
    expect(
      parseHarrisHearing(
        HEADER,
        "1350510010006\t2025\tR\tF\tA1  \tDO THIET\t07/07/2025\t07/03/2025\t07/11/2025\tFC\tAgent \t822642\t952412\t822642\t949900",
      ),
    ).toEqual({
      account: "1350510010006",
      taxYear: 2025,
      scheduledHearing: "2025-07-07",
      actualHearing: "2025-07-03",
      releaseDate: "2025-07-11",
      stage: "formal",
      initialValue: 952412,
      finalValue: 949900,
      withdrawn: false,
    });
  });
});

describe("planCaseUpdate", () => {
  it("confirms the county received the protest", () => {
    const u = planCaseUpdate(fresh, rec({ protestedAt: "2025-04-29" }), CAD);
    expect(u.patch).toEqual({ status: "filed" });
    expect(u.events[0]).toContain("received on April 29, 2025");
  });

  it("fills a scheduled hearing date", () => {
    const u = planCaseUpdate(
      { ...fresh, status: "filed" },
      rec({ protestedAt: "2025-04-29", scheduledHearing: "2025-07-07" }),
      CAD,
    );
    expect(u.patch).toEqual({ hearing_date: "2025-07-07", status: "hearing_scheduled" });
  });

  it("records the hearing and the released final value", () => {
    const u = planCaseUpdate(
      { ...fresh, status: "hearing_scheduled", hearing_date: "2025-07-07" },
      rec({
        protestedAt: "2025-04-29",
        scheduledHearing: "2025-07-07",
        actualHearing: "2025-07-03",
        releaseDate: "2025-07-11",
        initialValue: 952412,
        finalValue: 949900,
      }),
      CAD,
    );
    expect(u.patch).toEqual({
      hearing_completed_at: "2025-07-03T12:00:00Z",
      final_value: 949900,
      arb_decision_date: "2025-07-11",
      status: "decision_received",
    });
    expect(u.events.at(-1)).toContain("$949,900 (from $952,412) on July 11, 2025");
  });

  it("never overwrites what the owner entered or moves a case backward", () => {
    const u = planCaseUpdate(
      { ...fresh, status: "resolved", final_value: 900_000, hearing_date: "2025-07-01" },
      rec({
        protestedAt: "2025-04-29",
        scheduledHearing: "2025-07-07",
        releaseDate: "2025-07-11",
        finalValue: 949900,
      }),
      CAD,
    );
    expect(u.patch).toEqual({});
    expect(u.events).toEqual([]);
  });

  it("only notes a withdrawal", () => {
    const u = planCaseUpdate(fresh, rec({ withdrawn: true, protestedAt: "2025-04-29" }), CAD);
    expect(u.patch).toEqual({});
    expect(u.events[0]).toContain("withdrawn");
  });
});
