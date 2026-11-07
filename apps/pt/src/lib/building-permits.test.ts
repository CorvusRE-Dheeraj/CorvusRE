import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValueAdding,
  loadBuildingPermits,
  permitFromRow,
  permitsSupported,
} from "./building-permits";

describe("building permits", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only Collin publishes permits as open data", () => {
    expect(permitsSupported("Collin Central Appraisal District")).toBe(true);
    expect(permitsSupported("Collin CAD")).toBe(true);
    expect(permitsSupported("Collin")).toBe(true);
    expect(permitsSupported("Dallas Central Appraisal District")).toBe(false);
    expect(permitsSupported(null)).toBe(false);
  });

  it("maps a Socrata row", () => {
    const p = permitFromRow({
      permitid: "991",
      permitnum: "B23-0042",
      permittypedescr: "Residential",
      permitsubtypedescr: "Addition",
      permitissueddate: "2024-03-15T00:00:00.000",
      permitissuedby: "City of Plano",
      permitbuildername: "Acme Builders",
      permitvalue: "45000",
      permitbldgarea: "",
      permitcomments: "  rear room  ",
    });
    expect(p).toEqual({
      id: "991",
      number: "B23-0042",
      type: "Residential",
      subtype: "Addition",
      issuedAt: "2024-03-15",
      issuedBy: "City of Plano",
      issuedTo: "Acme Builders",
      value: 45000,
      buildingArea: null,
      comments: "rear room",
    });
  });

  it("flags work that usually adds value", () => {
    expect(isValueAdding({ type: "Residential", subtype: "Swimming Pool" })).toBe(true);
    expect(isValueAdding({ type: "New Construction", subtype: null })).toBe(true);
    expect(isValueAdding({ type: "Residential", subtype: "Roof Repair" })).toBe(false);
  });

  it("queries by account number, newest first; null for unsupported counties", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ permitid: "1" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await loadBuildingPermits("Collin Central Appraisal District", " 2862428 ");
    expect(rows).toHaveLength(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("82ee-gbj5.json?propid=2862428");
    expect(decodeURIComponent(url)).toContain("$order=permitissueddate DESC");
    expect(await loadBuildingPermits("Harris Central Appraisal District", "1")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
