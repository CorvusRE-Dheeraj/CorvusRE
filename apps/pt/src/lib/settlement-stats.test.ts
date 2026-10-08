import { describe, expect, it } from "vitest";
import {
  aggregate,
  bandOf,
  classOf,
  cutPct,
  MIN_CELL,
  parseHarrisHearingLine,
  type HearingRow,
} from "../../../../supabase/pt/functions/_shared/settlement-stats";

const row = (x: Partial<HearingRow>): HearingRow => ({
  taxYear: 2025,
  stateClass: "F1",
  stage: "formal",
  heard: false,
  representation: "agent",
  initialValue: 2_000_000,
  finalValue: 1_900_000,
  withdrawn: false,
  ...x,
});

describe("classification", () => {
  it("maps state property classes", () => {
    expect(classOf("F1  ")).toBe("commercial");
    expect(classOf("F2")).toBe("industrial");
    expect(classOf("A1")).toBe("residential");
    expect(classOf("B2")).toBe("multifamily");
    expect(classOf("C1")).toBe("vacant_land");
    expect(classOf("XV")).toBe("other");
  });

  it("bands by initial value", () => {
    expect(bandOf(499_999)).toBe("under_500k");
    expect(bandOf(2_000_000)).toBe("1m_5m");
    expect(bandOf(25_000_000)).toBe("over_20m");
  });

  it("clamps cuts", () => {
    expect(cutPct(100, 90)).toBe(10);
    expect(cutPct(100, 1000)).toBe(-50);
  });
});

describe("aggregate", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row({ finalValue: 2_000_000 - i * 20_000 })), // 0-9% cuts
    ...Array.from({ length: 10 }, () => row({ representation: "owner", finalValue: 2_000_000 })),
    row({ withdrawn: true }),
    row({ stateClass: "XV" }),
  ];
  const cells = aggregate("Harris Central Appraisal District", rows);
  const cell = (rep: string) =>
    cells.find(
      (c) =>
        c.propertyClass === "commercial" &&
        c.valueBand === "1m_5m" &&
        c.representation === rep &&
        c.stage === "all",
    );

  it("summarizes the outcomes in each cell", () => {
    const all = cell("all")!;
    expect(all.protests).toBe(20); // withdrawn and exempt left out
    expect(all.reduced).toBe(9);
    expect(all.medianCutPct).toBe(0);
    const agent = cell("agent")!;
    expect(agent.medianCutPct).toBe(4.5);
    expect(agent.medianCutWhenReducedPct).toBe(5);
  });

  it("drops cells too small to be a pattern", () => {
    expect(cells.every((c) => c.protests >= MIN_CELL)).toBe(true);
    expect(cells.some((c) => c.stage === "informal")).toBe(false);
  });
});

describe("parseHarrisHearingLine", () => {
  it("reads the published layout", () => {
    const header =
      "acct\tTax_Year\tReal_Personal_Property\tHearing_Type\tState_Class_Code\tOwner_Name\tScheduled_for_Date\tActual_Hearing_Date\tRelease_Date\tLetter_Type\tAgent_Code\tInitial_Appraised_Value\tInitial_Market_Value\tFinal_Appraised_Value\tFinal_Market_Value".split(
        "\t",
      );
    const r = parseHarrisHearingLine(
      header,
      "0010020000001\t2025\tR\tF\tF1  \tCURRENT OWNER\t10/06/2025\t10/02/2025\t10/10/2025\tTC\tAgent \t310356\t310356\t300000\t300000",
    )!;
    expect(r).toMatchObject({
      taxYear: 2025,
      stage: "formal",
      heard: true,
      representation: "agent",
      initialValue: 310356,
      finalValue: 300000,
      withdrawn: false,
    });
  });
});
