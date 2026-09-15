import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

const { invokeEdgeFunction } = await import("./edge-functions");

function rateLimitedError() {
  const context = {
    status: 429,
    clone: () => ({
      json: async () => ({ error: "AI is rate-limited. Please retry in a moment." }),
    }),
  } as unknown as Response;
  return { data: null, error: Object.assign(new Error("non-2xx status code"), { context }) };
}

function serverError() {
  const context = {
    status: 500,
    clone: () => ({ json: async () => ({ error: "unknown error" }) }),
  } as unknown as Response;
  return { data: null, error: Object.assign(new Error("non-2xx status code"), { context }) };
}

// No `context` at all — how supabase-js's FunctionsFetchError actually shows
// up (the fetch() itself never got a response), as opposed to serverError()
// above which has a real HTTP response with a non-2xx status.
function networkError() {
  return {
    data: null,
    error: new Error("Failed to send a request to the Edge Function"),
  };
}

describe("invokeEdgeFunction", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns data straight through on success, with no retry", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await invokeEdgeFunction("ai-report-modules", {});

    expect(result).toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff and succeeds once the rate limit clears", async () => {
    mockInvoke
      .mockResolvedValueOnce(rateLimitedError())
      .mockResolvedValueOnce(rateLimitedError())
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const promise = invokeEdgeFunction("ai-report-modules", {});
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("gives up and throws the extracted message after exhausting retries on a persistent 429", async () => {
    mockInvoke.mockResolvedValue(rateLimitedError());

    // Attach the rejection expectation before advancing timers, so the rejection
    // (which fires mid-advance) is never briefly unhandled.
    const assertion = expect(invokeEdgeFunction("ai-report-modules", {})).rejects.toThrow(
      "AI is rate-limited. Please retry in a moment.",
    );
    await vi.runAllTimersAsync();
    await assertion;
    // initial attempt + MAX_RETRIES(2) retries = 3 calls total, then it stops.
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-429 errors", async () => {
    mockInvoke.mockResolvedValueOnce(serverError());

    const assertion = expect(invokeEdgeFunction("ai-report-modules", {})).rejects.toThrow(
      "unknown error",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  // A FunctionsFetchError (fetch() itself never got a response — no `context`)
  // used to get zero retries, unlike a real 429/504 HTTP response — seen live
  // as "Subscription reconcile failed: FunctionsFetchError" while the same
  // function succeeded immediately when called again moments later, i.e. a
  // transient network blip that a retry would paper over.
  it("retries a network-level failure (no response at all) and succeeds", async () => {
    mockInvoke
      .mockResolvedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const promise = invokeEdgeFunction("sync-my-subscriptions", {});
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries on a persistent network failure", async () => {
    mockInvoke.mockResolvedValue(networkError());

    const assertion = expect(invokeEdgeFunction("sync-my-subscriptions", {})).rejects.toThrow(
      "Failed to send a request to the Edge Function",
    );
    await vi.runAllTimersAsync();
    await assertion;
    // initial attempt + MAX_RETRIES_NETWORK(2) retries = 3 calls total.
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });
});
