import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  grantPendingRewardsForReferrer,
  grantReferralRewardIfDue,
  runReferralRewards,
  type AdminLike,
  type StripeLike,
} from "../../../../supabase-pt/functions/_shared/referral-reward";

// Minimal in-memory stand-in for the slice of supabase-js the reward logic
// uses. Every terminal await yields once first, so two concurrent callers
// really do interleave (the case the old check-then-credit-then-flag code lost).
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function makeAdmin(tables: Tables, opts: { failUpdates?: () => boolean } = {}): AdminLike {
  return {
    from(table: string) {
      const rows = tables[table];
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      let sort: { col: string; asc: boolean } | null = null;
      let max = Infinity;
      let returnRows = false;
      const q = {
        select() {
          if (mode === "update") returnRows = true;
          return q;
        },
        update(p: Row) {
          mode = "update";
          patch = p;
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return q;
        },
        is(col: string, val: null) {
          filters.push((r) => (r[col] ?? null) === val);
          return q;
        },
        not(col: string, _op: string, val: null) {
          filters.push((r) => (r[col] ?? null) !== val);
          return q;
        },
        order(col: string, o: { ascending: boolean }) {
          sort = { col, asc: o.ascending };
          return q;
        },
        limit(n: number) {
          max = n;
          return q;
        },
        async maybeSingle() {
          const { data } = (await q) as unknown as { data: Row[] };
          return { data: data[0] ?? null, error: null };
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return (async () => {
            await Promise.resolve(); // yield: lets concurrent callers interleave
            let hit = rows.filter((r) => filters.every((f) => f(r)));
            if (mode === "update") {
              if (opts.failUpdates?.()) return { data: null, error: new Error("db down") };
              hit.forEach((r) => Object.assign(r, patch));
              return { data: returnRows ? hit.map((r) => ({ id: r.id })) : null, error: null };
            }
            if (sort) {
              const { col, asc } = sort;
              hit = [...hit].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
            }
            return { data: hit.slice(0, max), error: null };
          })().then(resolve, reject);
        },
      };
      return q;
    },
  };
}

// dedupeKeys=false models a Stripe that ignores the idempotency key, so a test
// can prove the DB claim alone prevents a double credit.
function makeStripe(failFirst = 0, dedupeKeys = true) {
  let failures = failFirst;
  const credits: { customerId: string; amount: number; key?: string }[] = [];
  const stripe: StripeLike = {
    subscriptions: {
      retrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 30_000 }, quantity: 1 }] } })),
    },
    customers: {
      createBalanceTransaction: vi.fn(async (customerId, params, o) => {
        if (failures > 0) {
          failures--;
          throw new Error("stripe down");
        }
        // Real Stripe returns the SAME transaction for a repeated key.
        if (dedupeKeys && o?.idempotencyKey && credits.some((c) => c.key === o.idempotencyKey)) return {};
        credits.push({ customerId, amount: params.amount, key: o?.idempotencyKey });
        return {};
      }),
    },
  };
  return { stripe, credits };
}

let tables: Tables;
beforeEach(() => {
  tables = {
    profiles: [
      { id: "referrer", stripe_customer_id: "cus_ref", referred_by: null, referral_reward_granted_at: null },
      { id: "friend", stripe_customer_id: "cus_friend", referred_by: "referrer", referral_reward_granted_at: null },
    ],
    properties: [
      { id: "p1", user_id: "referrer", subscription_status: "active", stripe_subscription_id: "sub_ref", created_at: "2026-01-01" },
      { id: "p2", user_id: "friend", subscription_status: "active", stripe_subscription_id: "sub_friend", created_at: "2026-02-01" },
    ],
    bpp_accounts: [],
  };
});

const granted = (id: string) => tables.profiles.find((p) => p.id === id)!.referral_reward_granted_at;

describe("grantReferralRewardIfDue", () => {
  it("credits the referrer the amount of their own subscription, once", async () => {
    const { stripe, credits } = makeStripe();
    await grantReferralRewardIfDue(stripe, makeAdmin(tables), "friend");
    expect(credits).toEqual([{ customerId: "cus_ref", amount: -30_000, key: "referral-reward:friend" }]);
    expect(granted("friend")).not.toBeNull();
  });

  it("two concurrent webhook deliveries credit exactly once (claim alone, no help from Stripe)", async () => {
    const { stripe, credits } = makeStripe(0, false);
    const admin = makeAdmin(tables);
    await Promise.all([
      grantReferralRewardIfDue(stripe, admin, "friend"),
      grantReferralRewardIfDue(stripe, admin, "friend"),
      grantReferralRewardIfDue(stripe, admin, "friend"),
    ]);
    expect(credits).toHaveLength(1);
  });

  it("a later re-delivery after success does nothing", async () => {
    const { stripe, credits } = makeStripe();
    const admin = makeAdmin(tables);
    await grantReferralRewardIfDue(stripe, admin, "friend");
    await grantReferralRewardIfDue(stripe, admin, "friend");
    expect(credits).toHaveLength(1);
  });

  it("gives the claim back when Stripe fails, so a retry can still pay", async () => {
    const { stripe, credits } = makeStripe(1);
    const admin = makeAdmin(tables);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await grantReferralRewardIfDue(stripe, admin, "friend");
    expect(credits).toHaveLength(0);
    expect(granted("friend")).toBeNull();
    await grantReferralRewardIfDue(stripe, admin, "friend");
    expect(credits).toHaveLength(1);
    expect(granted("friend")).not.toBeNull();
  });

  it("claims nothing while the referrer isn't a paying customer yet", async () => {
    tables.profiles[0].stripe_customer_id = null;
    const { stripe, credits } = makeStripe();
    await grantReferralRewardIfDue(stripe, makeAdmin(tables), "friend");
    expect(credits).toHaveLength(0);
    expect(granted("friend")).toBeNull();
  });

  it("claims nothing when the referrer has no active subscription", async () => {
    tables.properties[0].subscription_status = "canceled";
    const { stripe, credits } = makeStripe();
    await grantReferralRewardIfDue(stripe, makeAdmin(tables), "friend");
    expect(credits).toHaveLength(0);
    expect(granted("friend")).toBeNull();
  });

  it("ignores users nobody referred", async () => {
    const { stripe, credits } = makeStripe();
    await grantReferralRewardIfDue(stripe, makeAdmin(tables), "referrer");
    expect(credits).toHaveLength(0);
  });
});

describe("grantPendingRewardsForReferrer (rewards that used to be lost)", () => {
  it("pays a referral that converted before the referrer was a customer", async () => {
    tables.profiles[0].stripe_customer_id = null;
    tables.properties[0].subscription_status = "incomplete";
    const { stripe, credits } = makeStripe();
    const admin = makeAdmin(tables);
    await grantReferralRewardIfDue(stripe, admin, "friend"); // friend pays first: nothing yet
    expect(credits).toHaveLength(0);

    // the referrer now subscribes
    tables.profiles[0].stripe_customer_id = "cus_ref";
    tables.properties[0].subscription_status = "active";
    await runReferralRewards(stripe, admin, "referrer");
    expect(credits).toHaveLength(1);
    expect(credits[0].customerId).toBe("cus_ref");
  });

  it("does not pay for a referral that signed up but never subscribed", async () => {
    tables.properties = tables.properties.filter((p) => p.user_id !== "friend");
    const { stripe, credits } = makeStripe();
    await grantPendingRewardsForReferrer(stripe, makeAdmin(tables), "referrer");
    expect(credits).toHaveLength(0);
    expect(granted("friend")).toBeNull();
  });

  it("pays each waiting referral once, even across repeated passes", async () => {
    tables.profiles.push({ id: "friend2", stripe_customer_id: "cus_f2", referred_by: "referrer", referral_reward_granted_at: null });
    tables.properties.push({ id: "p3", user_id: "friend2", subscription_status: "active", stripe_subscription_id: "sub_f2", created_at: "2026-03-01" });
    const { stripe, credits } = makeStripe();
    const admin = makeAdmin(tables);
    await grantPendingRewardsForReferrer(stripe, admin, "referrer");
    await grantPendingRewardsForReferrer(stripe, admin, "referrer");
    expect(credits.map((c) => c.key).sort()).toEqual(["referral-reward:friend", "referral-reward:friend2"]);
  });
});
