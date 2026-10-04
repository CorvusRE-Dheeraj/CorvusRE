import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./cad-lookup", () => ({
  cadLookupPreview: vi.fn(),
}));
vi.mock("./google-places", () => ({
  fetchGoogleTextSearch: vi.fn(),
  GOOGLE_API_KEY: "test-key",
}));

import { unifiedPropertySearch, guessLikelyCountyName, type UnifiedMatch } from "./unified-search";
import { cadLookupPreview } from "./cad-lookup";
import { fetchGoogleTextSearch } from "./google-places";
import type { CadRecord, CadLookupResult } from "./cad-lookup";

function record(overrides: Partial<CadRecord> = {}): CadRecord {
  return {
    ownerName: "Some Owner",
    propertyAddress: "123 Main St, Denton, TX",
    cad: "Denton CAD",
    accountNumber: "ACC-1",
    propertyType: "Commercial",
    landValue: 100,
    improvementValue: 200,
    totalValue: 300,
    taxYear: 2026,
    ...overrides,
  } as CadRecord;
}

// Deferred promise so a test can control exactly when a mocked lookup
// resolves — needed to assert on the "pending" state a row sits in before
// its CAD lookup settles.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(cadLookupPreview).mockReset();
  vi.mocked(fetchGoogleTextSearch).mockReset();
});

// Collects every onUpdate call so assertions can inspect the full sequence
// of streamed states, not just the final one.
async function runSearch(query: string): Promise<UnifiedMatch[][]> {
  const updates: UnifiedMatch[][] = [];
  await unifiedPropertySearch(query, (matches) => updates.push(matches));
  return updates;
}

describe("unifiedPropertySearch", () => {
  it("shows a Google match immediately as 'pending', before its CAD lookup resolves", async () => {
    const gate = deferred<CadLookupResult>();
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Braum's", address: "123 Main St, Denton, TX", placeId: "p1" },
    ]);
    // First call is the direct search (resolved immediately below); the
    // google-path lookup is the one we hold open to inspect the pending
    // state.
    let callCount = 0;
    vi.mocked(cadLookupPreview).mockImplementation(() => {
      callCount += 1;
      return callCount === 1
        ? Promise.resolve({ matched: false, nearby: [] } as CadLookupResult)
        : gate.promise;
    });

    const updates: UnifiedMatch[][] = [];
    const done = unifiedPropertySearch("braums denton", (m) => updates.push(m));

    // Let the direct + google-text-search promises settle and the pending
    // row get upserted, without resolving the gated CAD lookup yet.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const pendingUpdate = updates.find((u) => u.some((m) => m.cadStatus === "pending"));
    expect(pendingUpdate).toBeDefined();
    const row = pendingUpdate!.find((m) => m.googleLabel === "Braum's")!;
    expect(row.cadStatus).toBe("pending");
    expect(row.address).toBe("123 Main St, Denton, TX");
    expect(row.record).toBeUndefined();

    gate.resolve({ matched: false, nearby: [] });
    await done;

    const final = updates[updates.length - 1];
    const finalRow = final.find((m) => m.googleLabel === "Braum's")!;
    expect(finalRow.cadStatus).toBe("none");
  });

  it("enriches a pending row in place (same id) once its CAD record resolves", async () => {
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Walmart Supercenter", address: "2750 W University Dr, Denton, TX", placeId: "p2" },
    ]);
    vi.mocked(cadLookupPreview).mockImplementation((q: string) =>
      q.includes("University")
        ? Promise.resolve({ matched: true, record: record({ accountNumber: "ACC-99" }) })
        : Promise.resolve({ matched: false, nearby: [] }),
    );

    const updates = await runSearch("walmart denton");
    const final = updates[updates.length - 1];
    expect(final).toHaveLength(1);
    const row = final[0];
    expect(row.id).toBe("google:p2");
    expect(row.cadStatus).toBe("found");
    expect(row.record?.accountNumber).toBe("ACC-99");

    // The row's id never changed across the whole update stream — same
    // object identity from "pending" through to "found".
    const ids = new Set(updates.flat().filter((m) => m.googleLabel).map((m) => m.id));
    expect(ids.size).toBe(1);
  });

  it("merges a Google candidate's CAD record onto an existing row instead of duplicating it", async () => {
    const sharedRecord = record({ accountNumber: "ACC-SHARED", propertyAddress: "1 Shared Pl, Denton, TX" });
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Store A", address: "1 Shared Pl, Denton, TX", placeId: "pA" },
      { label: "Store B", address: "1 Shared Pl Suite 2, Denton, TX", placeId: "pB" },
    ]);
    vi.mocked(cadLookupPreview).mockImplementation((q: string) =>
      q.startsWith("1 Shared Pl")
        ? Promise.resolve({ matched: true, record: sharedRecord })
        : Promise.resolve({ matched: false, nearby: [] }),
    );

    const updates = await runSearch("store denton");
    const final = updates[updates.length - 1];
    // Both Google candidates resolved to the exact same parcel — only one
    // visible row, not two.
    const rowsWithRecord = final.filter((m) => m.record?.accountNumber === "ACC-SHARED");
    expect(rowsWithRecord).toHaveLength(1);
  });

  it("shows every parcel when one Google-resolved address has multiple CAD records on file", async () => {
    // Regression: confirmed live — a real Denton Braum's address resolved
    // to 2 separate CAD accounts, but only the last one ever stayed visible
    // because both records were upserted onto the same row id, so the
    // second silently overwrote the first.
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Braum's", address: "2922 W University Dr, Denton, TX", placeId: "p1" },
    ]);
    // Isolate the candidate's own lookup (by address) from the direct
    // search (by the raw typed text) so this exercises only the
    // one-candidate-multiple-records path, not the cross-source merge.
    vi.mocked(cadLookupPreview).mockImplementation((q: string) =>
      q.includes("University")
        ? Promise.resolve({
            matched: "multiple",
            options: [
              record({ accountNumber: "776568", totalValue: 100 }),
              record({ accountNumber: "776569", totalValue: 450000 }),
            ],
          })
        : Promise.resolve({ matched: false, nearby: [] }),
    );

    const updates = await runSearch("braums denton");
    const final = updates[updates.length - 1];
    const accountNumbers = final.map((m) => m.record?.accountNumber).sort();
    expect(accountNumbers).toEqual(["776568", "776569"]);
    // Both carry the Google label and both are marked "found", not just one.
    expect(final.every((m) => m.googleLabel === "Braum's" && m.cadStatus === "found")).toBe(true);
  });

  it("filters to the typed city once an in-city match exists, keeping out-of-city rows out", async () => {
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Braum's", address: "1 Main St, Denton, TX", placeId: "p1" },
      { label: "Braum's", address: "2 Main St, Plano, TX", placeId: "p2" },
    ]);
    vi.mocked(cadLookupPreview).mockResolvedValue({ matched: false, nearby: [] });

    const updates = await runSearch("braums denton");
    const final = updates[updates.length - 1];
    expect(final.every((m) => m.address.includes("Denton"))).toBe(true);
    expect(final.some((m) => m.address.includes("Plano"))).toBe(false);
  });

  it("falls back to showing everything when nothing matches the typed city", async () => {
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Braum's", address: "2 Main St, Plano, TX", placeId: "p2" },
    ]);
    vi.mocked(cadLookupPreview).mockResolvedValue({ matched: false, nearby: [] });

    const updates = await runSearch("braums denton");
    const final = updates[updates.length - 1];
    // No real Denton match exists among the results, so the Plano one
    // still shows rather than leaving the dropdown empty.
    expect(final).toHaveLength(1);
    expect(final[0].address).toContain("Plano");
  });

  it("never throws when Google Text Search itself fails", async () => {
    vi.mocked(fetchGoogleTextSearch).mockRejectedValue(new Error("network down"));
    vi.mocked(cadLookupPreview).mockResolvedValue({
      matched: true,
      record: record({ accountNumber: "ACC-DIRECT" }),
    });

    const updates = await runSearch("123 Main St Denton");
    const final = updates[updates.length - 1];
    expect(final).toHaveLength(1);
    expect(final[0].record?.accountNumber).toBe("ACC-DIRECT");
  });

  it("settles a row stuck on 'pending' to 'none' once the 3-minute cutoff hits, instead of spinning forever", async () => {
    // Regression: confirmed live ("it's been a long time, but still this
    // is looking") on a real address whose county CAD lookup never
    // returned — the row just kept showing its spinner indefinitely,
    // because the timeout only stopped FUTURE updates, never resolved the
    // one already in flight.
    vi.useFakeTimers();
    try {
      vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
        { label: "Braum's", address: "529 S Interstate 35 E, Denton, TX", placeId: "p1" },
      ]);
      // A CAD lookup that never settles — simulates a county endpoint that
      // hangs past the cutoff.
      vi.mocked(cadLookupPreview).mockImplementation(() => new Promise(() => {}));

      const updates: UnifiedMatch[][] = [];
      const done = unifiedPropertySearch("braums denton", (m) => updates.push(m));

      await vi.advanceTimersByTimeAsync(3 * 60_000);
      await done;

      const final = updates[updates.length - 1];
      const row = final.find((m) => m.googleLabel === "Braum's")!;
      expect(row.cadStatus).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes each Google candidate's own county through to cadLookupPreview as a hint", async () => {
    // Confirmed live this cuts a 5-candidate business-name search from up
    // to 60 concurrent county queries down to ~5 (one per candidate)
    // instead of blind-firing all 12 counties for every single one — see
    // this file's own top-of-file comment and cad-lookup/index.ts's
    // COUNTY_QUERY_BY_HINT for the full story.
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Taco Bell", address: "681 Fort Worth Dr, Denton, TX", placeId: "p1", county: "Denton County" },
    ]);
    vi.mocked(cadLookupPreview).mockResolvedValue({ matched: false, nearby: [] });

    await runSearch("tacobell denton");

    expect(cadLookupPreview).toHaveBeenCalledWith("681 Fort Worth Dr, Denton, TX", "Denton County");
  });

  it("merges a Google candidate onto a direct-search row for the same parcel, not a duplicate", async () => {
    // Regression: confirmed live ("Walmart Denton" showing every real
    // parcel TWICE — once unlabeled, once again labeled "Walmart
    // Supercenter"). The direct search (on the raw typed text "walmart
    // denton") finds the parcel first via our own owner-name search; the
    // Google candidate for the same store resolves to the identical
    // parcel moments later. Only one row should ever reach the caller, and
    // it should end up WITH the Google label attached (more informative),
    // not without it.
    const sharedRecord = record({ accountNumber: "618926", propertyAddress: "2750 W UNIVERSITY DR, DENTON, TX" });
    vi.mocked(cadLookupPreview).mockImplementation((q: string) =>
      q === "walmart denton" || q.includes("University")
        ? Promise.resolve({ matched: true, record: sharedRecord })
        : Promise.resolve({ matched: false, nearby: [] }),
    );
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Walmart Supercenter", address: "2750 W University Dr, Denton, TX", placeId: "p1" },
    ]);

    const updates = await runSearch("walmart denton");
    const final = updates[updates.length - 1];
    const rowsForParcel = final.filter((m) => m.record?.accountNumber === "618926");
    expect(rowsForParcel).toHaveLength(1);
    expect(rowsForParcel[0].googleLabel).toBe("Walmart Supercenter");
  });

  it("merges a direct-search row onto a Google candidate's row when Google resolves FIRST", async () => {
    // Same real bug as the test above, the other ordering — reported again
    // right after that fix shipped, because direct and each Google
    // candidate's own CAD lookup race, and the Google candidate (a plain
    // address lookup) often resolves before direct's slower owner-name
    // search does. The fix above only taught direct to REGISTER itself for
    // a later Google match to find; it never taught direct to check
    // whether a row already existed when IT resolves second. Forces that
    // exact ordering here: the Google candidate's lookup resolves
    // immediately, direct's stays pending until released afterward.
    const sharedRecord = record({ accountNumber: "618926", propertyAddress: "2750 W UNIVERSITY DR, DENTON, TX" });
    const directGate = deferred<CadLookupResult>();
    vi.mocked(cadLookupPreview).mockImplementation((q: string) =>
      q === "walmart denton" ? directGate.promise : Promise.resolve({ matched: true, record: sharedRecord }),
    );
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Walmart Supercenter", address: "2750 W University Dr, Denton, TX", placeId: "p1" },
    ]);

    const updates: UnifiedMatch[][] = [];
    const done = unifiedPropertySearch("walmart denton", (m) => updates.push(m));

    // Let the Google candidate's row resolve and claim the parcel first.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(updates.flat().some((m) => m.record?.accountNumber === "618926")).toBe(true);

    // Now let direct resolve to the SAME parcel.
    directGate.resolve({ matched: true, record: sharedRecord });
    await done;

    const final = updates[updates.length - 1];
    const rowsForParcel = final.filter((m) => m.record?.accountNumber === "618926");
    expect(rowsForParcel).toHaveLength(1);
    expect(rowsForParcel[0].googleLabel).toBe("Walmart Supercenter");
  });

  it("marks an out-of-coverage county 'unsupported' without ever calling cadLookupPreview for it", async () => {
    // Regression: confirmed live ("denver walmart" shown under a real,
    // minutes-long "Searching Dallas County records…" spinner) — a county
    // CAD sweep was being attempted against an address we can never serve.
    // Google's own addressComponents already name the county; this should
    // be recognized and skipped entirely, not just shown with a spinner
    // that eventually gives up.
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([
      { label: "Walmart", address: "2770 West Evans Avenue, Denver, CO", placeId: "p1", county: "Denver County" },
    ]);
    vi.mocked(cadLookupPreview).mockResolvedValue({ matched: false, nearby: [] });

    const updates = await runSearch("denver walmart");
    const final = updates[updates.length - 1];
    expect(final).toHaveLength(1);
    expect(final[0].cadStatus).toBe("unsupported");
    // The direct search still runs (it's on the raw typed text, not scoped
    // to any county), so cadLookupPreview IS called once for that — but
    // never for the out-of-coverage Google candidate's own address.
    expect(cadLookupPreview).not.toHaveBeenCalledWith(
      "2770 West Evans Avenue, Denver, CO",
      expect.anything(),
    );
  });

  it("marks a directly-typed out-of-state address 'unsupported' without sweeping Texas counties for it", async () => {
    // Regression: confirmed live ("2770 West Evans Avenue, Denver, CO
    // 80219" typed directly, not via a Google suggestion) — the direct
    // search's own house+street-core sweep has no concept of state at all,
    // and genuinely returned a confident-looking but completely wrong
    // Bexar County match ("2770 E Evans Rd, San Antonio") purely because
    // the house number and street core happened to collide.
    const wrongTexasRecord = record({
      accountNumber: "660938",
      propertyAddress: "2770 E EVANS RD, SAN ANTONIO, TX, 78259",
      cad: "Bexar Appraisal District",
    });
    vi.mocked(cadLookupPreview).mockResolvedValue({ matched: true, record: wrongTexasRecord });
    vi.mocked(fetchGoogleTextSearch).mockResolvedValue([]);

    const updates = await runSearch("2770 West Evans Avenue, Denver, CO 80219");
    const final = updates[updates.length - 1];
    expect(final).toHaveLength(1);
    expect(final[0].cadStatus).toBe("unsupported");
    expect(final[0].record).toBeUndefined();
    expect(cadLookupPreview).not.toHaveBeenCalled();
  });
});

describe("guessLikelyCountyName", () => {
  // Backs LiveSearchLoader's "show the real likely county instead of
  // cycling through all 13" behavior — found live ("searching Collin
  // County" shown for a typed "walmart dallas" read as random and wrong).
  it("recognizes a known city anywhere in the query", () => {
    expect(guessLikelyCountyName("walmart dallas")).toBe("Dallas");
    expect(guessLikelyCountyName("dental frisco")).toBe("Collin");
    expect(guessLikelyCountyName("braums denton west univ dr")).toBe("Denton");
  });

  it("returns null for an unrecognized or empty query, never a wrong guess", () => {
    expect(guessLikelyCountyName("some random business")).toBeNull();
    expect(guessLikelyCountyName("")).toBeNull();
  });
});
