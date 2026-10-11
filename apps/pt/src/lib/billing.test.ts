// @vitest-environment jsdom
// startPropertyCheckout/openBillingPortal write to window.location, which
// doesn't exist under the default node environment set in vitest.config.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockQueryBuilder } from "./test-utils/supabase-query-mock";

const mockFrom = vi.fn();
const mockInvoke = vi.fn();

vi.mock("./supabase", () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
vi.mock("./edge-functions", () => ({
  invokeEdgeFunction: (...args: unknown[]) => mockInvoke(...args),
}));

// Imported after the mocks above so billing.ts picks up the mocked modules.
const {
  getMyBilling,
  startPropertyCheckout,
  openBillingPortal,
  cancelPropertySubscription,
  resumePropertySubscription,
  bracketForValue,
  propertyMonthlyPrice,
  propertyAnnualPrice,
  isCustomPricedValue,
  isLaunchDiscountActive,
  checkoutDiscountFor,
} = await import("./billing");

describe("getMyBilling", () => {
  it("reads the real plan column off profiles", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: { plan: "owner_managed" }, error: null }));

    const result = await getMyBilling("user-1");

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(result).toEqual({ plan: "owner_managed" });
  });

  it("throws when Supabase returns an error", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: new Error("row not found") }));
    await expect(getMyBilling("user-1")).rejects.toThrow("row not found");
  });
});

describe("startPropertyCheckout", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    mockInvoke.mockReset();
    // jsdom's window.location isn't directly assignable; delete + redefine.
    // @ts-expect-error -- test-only override
    delete window.location;
    // @ts-expect-error -- test-only override
    window.location = { href: "" };
  });

  afterEach(() => {
    // @ts-expect-error -- test-only override
    window.location = originalLocation;
  });

  it("calls create-checkout-session with the property/tier/base-path-aware redirect paths and redirects to the returned URL", async () => {
    mockInvoke.mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" });

    await startPropertyCheckout("prop-1", "owner_managed");

    expect(mockInvoke).toHaveBeenCalledWith("create-checkout-session", {
      propertyId: "prop-1",
      tier: "owner_managed",
      successPath: `${import.meta.env.BASE_URL}dashboard/properties?checkout=success`,
      cancelPath: `${import.meta.env.BASE_URL}dashboard/properties`,
    });
    expect(window.location.href).toBe("https://checkout.stripe.com/session/abc");
  });

  it("throws instead of redirecting when Stripe returns no URL", async () => {
    mockInvoke.mockResolvedValue({ url: "" });
    await expect(startPropertyCheckout("prop-1", "corvusrf_managed")).rejects.toThrow(
      /did not return a checkout URL/,
    );
    expect(window.location.href).toBe("");
  });
});

describe("openBillingPortal", () => {
  it("calls create-billing-portal-session and redirects to the returned URL", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ url: "https://billing.stripe.com/portal/abc" });
    // @ts-expect-error -- test-only override
    delete window.location;
    // @ts-expect-error -- test-only override
    window.location = { href: "" };

    await openBillingPortal();

    expect(mockInvoke).toHaveBeenCalledWith("create-billing-portal-session", {
      returnPath: `${import.meta.env.BASE_URL}dashboard`,
    });
    expect(window.location.href).toBe("https://billing.stripe.com/portal/abc");
  });
});

describe("cancelPropertySubscription", () => {
  it("calls cancel-property-subscription with the property id", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true });
    await cancelPropertySubscription("prop-1");
    expect(mockInvoke).toHaveBeenCalledWith("cancel-property-subscription", {
      propertyId: "prop-1",
    });
  });
});

describe("resumePropertySubscription", () => {
  it("calls resume-subscription with the property id", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true });
    await resumePropertySubscription("prop-1");
    expect(mockInvoke).toHaveBeenCalledWith("resume-subscription", { propertyId: "prop-1" });
  });
});

describe("bracketForValue / isCustomPricedValue", () => {
  it("puts every checkout-eligible property in the one fixed-price bracket", () => {
    expect(bracketForValue(1_500_000)).toBe("upTo5m");
    expect(bracketForValue(4_999_999)).toBe("upTo5m");
    expect(bracketForValue(null)).toBe("upTo5m");
  });

  it("treats $5M and up as custom-priced, and a missing value as not", () => {
    expect(isCustomPricedValue(4_999_999)).toBe(false);
    expect(isCustomPricedValue(5_000_000)).toBe(true);
    expect(isCustomPricedValue(null)).toBe(false);
    expect(isCustomPricedValue(undefined)).toBe(false);
  });
});

describe("propertyMonthlyPrice / propertyAnnualPrice", () => {
  it("is $299/mo, billed as $3,588/yr, for both tiers", () => {
    expect(propertyMonthlyPrice("owner_managed", "upTo5m", false)).toBe(299);
    expect(propertyAnnualPrice("owner_managed", "upTo5m", false)).toBe(3588);
    expect(propertyAnnualPrice("corvusrf_managed", "upTo5m", false)).toBe(3588);
  });

  it("discounts 15% for an additional property in the same bracket", () => {
    // 299 * 0.85 = 254.15/mo -> 3049.80/yr
    expect(propertyMonthlyPrice("owner_managed", "upTo5m", true)).toBeCloseTo(254.15, 5);
    expect(propertyAnnualPrice("owner_managed", "upTo5m", true)).toBeCloseTo(3049.8, 5);
  });
});

describe("checkoutDiscountFor", () => {
  const beforeDeadline = new Date("2027-01-31T12:00:00Z");
  // Feb 1 2027 00:00 US Central = 06:00 UTC
  const atDeadline = new Date("2027-02-01T06:00:00Z");

  it("gives the 50% first-year launch discount only before Feb 1 2027", () => {
    expect(isLaunchDiscountActive(beforeDeadline)).toBe(true);
    expect(isLaunchDiscountActive(atDeadline)).toBe(false);
    expect(checkoutDiscountFor(false, beforeDeadline)).toEqual({ kind: "launch", percentOff: 0.5 });
    expect(checkoutDiscountFor(false, atDeadline)).toBeNull();
  });

  it("gives franchise owners 50% off instead of (not on top of) the launch discount", () => {
    expect(checkoutDiscountFor(true, beforeDeadline)).toEqual({
      kind: "franchise",
      percentOff: 0.5,
    });
    expect(checkoutDiscountFor(true, atDeadline)).toEqual({ kind: "franchise", percentOff: 0.5 });
  });
});
