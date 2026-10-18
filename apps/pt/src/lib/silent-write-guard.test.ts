import { describe, expect, it, vi } from "vitest";
import { withSilentWriteGuard } from "./silent-write-guard";

const BASE = "https://x.supabase.co/rest/v1";
const reply = (range: string, status = 204) =>
  vi.fn(
    async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status, headers: { "Content-Range": range } }),
  );

describe("withSilentWriteGuard", () => {
  it("turns a zero-row targeted delete into an error with the table's message", async () => {
    const base = reply("*/0");
    const res = await withSilentWriteGuard(base)(`${BASE}/properties?id=eq.abc`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/cancel it first/);
    expect(new Headers(base.mock.calls[0][1]?.headers).get("Prefer")).toBe("count=exact");
  });

  it("passes a one-row update through and keeps existing Prefer values", async () => {
    const base = reply("0-0/1");
    const res = await withSilentWriteGuard(base)(`${BASE}/protests?id=eq.abc`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
    });
    expect(res.status).toBe(204);
    expect(new Headers(base.mock.calls[0][1]?.headers).get("Prefer")).toBe(
      "return=representation,count=exact",
    );
  });

  it("uses the generic message for other tables", async () => {
    const res = await withSilentWriteGuard(reply("*/0"))(`${BASE}/documents?id=eq.abc`, {
      method: "PATCH",
    });
    expect((await res.json()).message).toMatch(/view access/);
  });

  it("leaves writes without an id filter, reads and inserts alone", async () => {
    for (const [url, method] of [
      [`${BASE}/documents?user_id=eq.u`, "PATCH"],
      [`${BASE}/documents?id=eq.abc`, "GET"],
      [`${BASE}/documents`, "POST"],
    ] as const) {
      const base = reply("*/0");
      const res = await withSilentWriteGuard(base)(url, { method });
      expect(res.status).toBe(204);
      expect(new Headers(base.mock.calls[0][1]?.headers).get("Prefer")).toBeNull();
    }
  });
});
