import { beforeEach, describe, expect, it, vi } from "vitest";

let row: { verification_status: string } | null = null;
let fail = false;
vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            fail ? { data: null, error: { message: "x" } } : { data: row, error: null },
        }),
      }),
    }),
  },
}));
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: vi.fn() }));

import { propertyHoldReason } from "./property-verification";

beforeEach(() => {
  row = null;
  fail = false;
});

describe("propertyHoldReason", () => {
  it("holds a property that is still being checked", async () => {
    row = { verification_status: "pending" };
    expect(await propertyHoldReason("p1")).toMatch(/checking this property/);
  });
  it("holds one under staff review", async () => {
    row = { verification_status: "needs_review" };
    expect(await propertyHoldReason("p1")).toMatch(/reviewing/);
  });
  it("lets a verified (or admin test) property through", async () => {
    row = { verification_status: "verified" };
    expect(await propertyHoldReason("p1")).toBeNull();
    row = { verification_status: "test" };
    expect(await propertyHoldReason("p1")).toBeNull();
  });
  it("on a failed lookup, leaves the decision to the database", async () => {
    fail = true;
    expect(await propertyHoldReason("p1")).toBeNull();
  });
});
