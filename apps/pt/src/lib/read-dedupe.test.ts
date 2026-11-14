import { describe, expect, it, vi } from "vitest";
import { withReadDedupe } from "./read-dedupe";

const REST = "https://x.supabase.co/rest/v1/protests?select=id&user_id=eq.u1";

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withReadDedupe", () => {
  it("shares one request between identical concurrent reads, each with its own body", async () => {
    const d = deferred();
    const base = vi.fn(() => d.promise);
    const f = withReadDedupe(base as unknown as typeof fetch);
    const init = { headers: { Authorization: "Bearer a" } };
    const a = f(REST, init);
    const b = f(REST, init);
    d.resolve(new Response('[{"id":1}]'));
    expect(await (await a).json()).toEqual([{ id: 1 }]);
    expect(await (await b).json()).toEqual([{ id: 1 }]);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("sends a fresh request once the first has finished (no caching)", async () => {
    const base = vi.fn(async () => new Response("[]"));
    const f = withReadDedupe(base as unknown as typeof fetch);
    await (await f(REST)).text();
    await (await f(REST)).text();
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("never shares between different users or different headers", async () => {
    const base = vi.fn(() => new Promise<Response>(() => {}));
    const f = withReadDedupe(base as unknown as typeof fetch);
    f(REST, { headers: { Authorization: "Bearer a" } });
    f(REST, { headers: { Authorization: "Bearer b" } });
    f(REST, {
      headers: { Authorization: "Bearer a", Accept: "application/vnd.pgrst.object+json" },
    });
    f(REST, { headers: { Authorization: "Bearer a", Prefer: "count=exact" } });
    expect(base).toHaveBeenCalledTimes(4);
  });

  it("a write makes the next identical read go to the database", async () => {
    const base = vi.fn(() => new Promise<Response>(() => {}));
    const f = withReadDedupe(base as unknown as typeof fetch);
    f(REST);
    f("https://x.supabase.co/rest/v1/protests?id=eq.1", { method: "PATCH", body: "{}" });
    f(REST);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("leaves non-REST and abortable requests alone", async () => {
    const base = vi.fn(() => new Promise<Response>(() => {}));
    const f = withReadDedupe(base as unknown as typeof fetch);
    f("https://x.supabase.co/auth/v1/user");
    f("https://x.supabase.co/auth/v1/user");
    const c = new AbortController();
    f(REST, { signal: c.signal });
    f(REST, { signal: c.signal });
    expect(base).toHaveBeenCalledTimes(4);
  });

  it("shares a failure too, and retries afterwards", async () => {
    let n = 0;
    const base = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new TypeError("network");
      return new Response("[]");
    });
    const f = withReadDedupe(base as unknown as typeof fetch);
    await expect(Promise.all([f(REST), f(REST)])).rejects.toThrow("network");
    expect(base).toHaveBeenCalledTimes(1);
    expect((await f(REST)).ok).toBe(true);
  });
});
