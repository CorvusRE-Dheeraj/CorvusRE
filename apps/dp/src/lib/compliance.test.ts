import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  countPdfPages,
  drawingKind,
  groupIssuesByDiscipline,
  isDaycare,
  issueCounts,
  mergeValues,
  VALUE_DEFS,
  type ComplianceIssue,
  type ConfirmedValue,
  type DrawingIndex,
  type ExtractedValue,
} from "./compliance";

const val = (key: string, value: string, extra: Partial<ExtractedValue> = {}): ExtractedValue => ({
  key,
  value,
  unit: null,
  page: 1,
  sheet: "A-001",
  source: null,
  basis: "annotation",
  confidence: "high",
  ...extra,
});
const index = (values: ExtractedValue[]): DrawingIndex => ({
  quality: "clear",
  pageCount: 1,
  sheets: [],
  values,
  flags: [],
});
const find = (m: ReturnType<typeof mergeValues>, key: string) => m.find((x) => x.def.key === key)!;

describe("mergeValues", () => {
  it("marks clear printed values as read, anything missing as missing", () => {
    const m = mergeValues(
      [{ id: "d1", name: "Arch.pdf", drawing_index: index([val("stories", "2")]) }],
      [],
      {
        daycare: false,
      },
    );
    expect(find(m, "stories").state).toBe("extracted");
    expect(find(m, "exits").state).toBe("missing");
    expect(m.some((x) => x.def.daycare)).toBe(false);
  });

  it("needs confirmation for low confidence, calculated values and sheets that disagree", () => {
    const m = mergeValues(
      [
        {
          id: "d1",
          name: "Arch.pdf",
          drawing_index: index([
            val("building_height", "32"),
            val("far", "0.4", { basis: "derived" }),
          ]),
        },
        {
          id: "d2",
          name: "Civil.pdf",
          drawing_index: index([
            val("building_height", "35", { confidence: "medium" }),
            val("exits", "2", { confidence: "low" }),
          ]),
        },
      ],
      [],
      { daycare: false },
    );
    const h = find(m, "building_height");
    expect(h.state).toBe("needs_confirmation");
    expect(h.best?.value).toBe("32");
    expect(h.conflicts.map((c) => c.value)).toEqual(["35"]);
    expect(find(m, "far").state).toBe("needs_confirmation");
    expect(find(m, "exits").state).toBe("needs_confirmation");
  });

  it("treats 1,200 SF and 1200 as the same value", () => {
    const m = mergeValues(
      [
        { id: "d1", name: "A", drawing_index: index([val("lot_area", "1,200 SF")]) },
        { id: "d2", name: "B", drawing_index: index([val("lot_area", "1200")]) },
      ],
      [],
      { daycare: false },
    );
    expect(find(m, "lot_area").conflicts).toEqual([]);
  });

  it("team confirmations win", () => {
    const confirmed: ConfirmedValue[] = [
      {
        id: "c",
        key: "exits",
        value: "3",
        unit: null,
        status: "corrected",
        consultant_id: null,
        note: null,
        updated_at: "",
      },
      {
        id: "n",
        key: "water_meter",
        value: null,
        unit: null,
        status: "not_applicable",
        consultant_id: null,
        note: null,
        updated_at: "",
      },
    ];
    const m = mergeValues(
      [{ id: "d1", name: "A", drawing_index: index([val("exits", "2", { confidence: "low" })]) }],
      confirmed,
      {
        daycare: true,
      },
    );
    expect(find(m, "exits").state).toBe("confirmed");
    expect(find(m, "water_meter").state).toBe("not_applicable");
    expect(m.filter((x) => x.def.daycare)).toHaveLength(VALUE_DEFS.filter((d) => d.daycare).length);
  });
});

describe("helpers", () => {
  it("detects daycare projects", () => {
    expect(isDaycare({ proposed_use: "Child care center" })).toBe(true);
    expect(isDaycare({ sector_subcategory: "daycare" })).toBe(true);
    expect(isDaycare({ proposed_use: "Retail" })).toBe(false);
  });

  it("classifies drawing files", () => {
    expect(drawingKind("A-101.PDF", "")).toBe("pdf");
    expect(drawingKind("site.dxf", "")).toBe("dxf");
    expect(drawingKind("site.dwg", "application/octet-stream")).toBe("dwg");
    expect(drawingKind("photo.png", "image/png")).toBeNull();
  });

  it("counts PDF pages without counting the page tree", () => {
    const pdf = new TextEncoder().encode(
      "<< /Type /Pages /Kids [] >> << /Type /Page >> << /Type/Page /Parent 1 0 R >>",
    );
    expect(countPdfPages(pdf)).toBe(2);
    expect(countPdfPages(new TextEncoder().encode("nothing"))).toBeNull();
  });

  it("groups issues by discipline, worst first, and counts them", () => {
    const base = {
      review_id: "r",
      area: "zoning",
      requirement: null,
      code_reference: null,
      code_source: "ai",
      document_id: null,
      sheet: null,
      location: null,
      problem: null,
      suggested_fix: null,
      confidence: "medium",
      needs_confirmation: false,
      consultant_id: null,
      note: null,
    } as const;
    const issues: ComplianceIssue[] = [
      { ...base, id: "1", discipline: "civil", severity: "low", title: "a", status: "open" },
      {
        ...base,
        id: "2",
        discipline: "architectural",
        severity: "medium",
        title: "b",
        status: "fixed",
      },
      { ...base, id: "3", discipline: "civil", severity: "critical", title: "c", status: "open" },
    ];
    const g = groupIssuesByDiscipline(issues);
    expect(g.map((x) => x.discipline.id)).toEqual(["architectural", "civil"]);
    expect(g[1].issues.map((i) => i.id)).toEqual(["3", "1"]);
    expect(issueCounts(issues)).toEqual({ total: 3, open: 2, critical: 1, resolved: 1 });
  });
});
