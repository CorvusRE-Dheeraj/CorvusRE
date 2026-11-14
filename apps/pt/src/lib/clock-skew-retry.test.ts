import { describe, expect, it, vi } from "vitest";
import { withClockSkewRetry } from "./clock-skew-retry";

const skew = () =>
  new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
    status: 401,
  });
const noWait = () => Promise.resolve();

describe("withClockSkewRetry", () => {
  it("retries once when the token is 'issued at future'", async () => {
    const base = vi.fn().mockResolvedValueOnce(skew()).mockResolvedValueOnce(new Response("[]"));
    const f = withClockSkewRetry(base as unknown as typeof fetch, noWait);
    const res = await f("https://x/rest/v1/t", { method: "PATCH", body: "{}" });
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 401s", async () => {
    const base = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"JWT expired"}', { status: 401 }));
    const f = withClockSkewRetry(base as unknown as typeof fetch, noWait);
    expect((await f("https://x/rest/v1/t")).status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("retries only once", async () => {
    const base = vi.fn().mockImplementation(async () => skew());
    const f = withClockSkewRetry(base as unknown as typeof fetch, noWait);
    expect((await f("https://x/rest/v1/t")).status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("passes successful responses straight through", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const f = withClockSkewRetry(base as unknown as typeof fetch, noWait);
    expect(await (await f("https://x/rest/v1/t")).text()).toBe("ok");
    expect(base).toHaveBeenCalledTimes(1);
  });
});
