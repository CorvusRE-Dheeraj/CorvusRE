import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { stableUser } from "./auth-user";

const user = (over: Partial<User> = {}): User =>
  ({ id: "u1", email: "a@b.com", updated_at: "2026-09-24T10:00:00Z", ...over }) as User;

describe("stableUser", () => {
  it("keeps the same object when the same account is re-announced (tab refocus)", () => {
    const prev = user();
    expect(stableUser(prev, user())).toBe(prev);
  });

  it("takes the new object when the profile data changed", () => {
    const next = user({ updated_at: "2026-09-24T11:00:00Z" });
    expect(stableUser(user(), next)).toBe(next);
  });

  it("takes the new object for a different account", () => {
    const next = user({ id: "u2" });
    expect(stableUser(user(), next)).toBe(next);
  });

  it("handles sign-in and sign-out", () => {
    const u = user();
    expect(stableUser(null, u)).toBe(u);
    expect(stableUser(u, null)).toBeNull();
  });
});
