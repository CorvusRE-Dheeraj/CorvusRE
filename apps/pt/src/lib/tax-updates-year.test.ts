import { describe, expect, it } from "vitest";
import { taxYearUpdates, type TaxReport, type TaxUpdate } from "./tax-updates";

const u = (title: string, isNew: boolean, counties: string[] = []): TaxUpdate =>
  ({ title, isNew, counties }) as unknown as TaxUpdate;
const r = (weekStart: string, updates: TaxUpdate[]): TaxReport =>
  ({
    id: weekStart,
    weekStart,
    title: "",
    summary: "",
    updates,
    sources: [],
    generatedAt: "",
  }) as TaxReport;

describe("taxYearUpdates", () => {
  it("keeps every update from the year, once", () => {
    const out = taxYearUpdates(
      [
        r("2026-10-05", [u("B", true)]),
        r("2026-09-21", [u("A", true), u("B", true)]),
        r("2025-12-29", [u("Old", false)]),
      ],
      [u("C", false, ["Dallas County"]), u("A", false)],
      2026,
    );
    expect(out.map((x) => x.title).sort()).toEqual(["A", "B", "C"]);
  });

  it("marks only the latest week's finds as new", () => {
    const out = taxYearUpdates(
      [r("2026-10-05", [u("B", true)]), r("2026-09-21", [u("A", true)])],
      [],
      2026,
    );
    expect(out.find((x) => x.title === "B")?.isNew).toBe(true);
    expect(out.find((x) => x.title === "A")?.isNew).toBe(false);
  });
});
