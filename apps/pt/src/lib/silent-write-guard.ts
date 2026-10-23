// Row Level Security doesn't reject an UPDATE or DELETE it doesn't allow — it
// just changes zero rows and reports success. So a blocked write (a view-only
// workspace member editing, deleting a property that still has a live
// subscription, …) used to show "Saved" / "Removed" while nothing happened.
//
// This wraps the Supabase client's fetch: an UPDATE or DELETE aimed at one
// row by id (`id=eq.<value>`) asks Postgres for the affected-row count, and
// zero rows becomes a clear error response — which supabase-js hands back as
// `error`, so every existing `if (error) throw error` + toast shows it.
// Writes without an id filter (bulk clears that may legitimately match
// nothing) are left alone.

const TABLE_MESSAGES: Record<string, { delete?: string; update?: string }> = {
  properties: {
    delete: "This property can't be removed while it has a subscription — cancel it first.",
  },
  bpp_accounts: {
    delete: "This BPP account can't be removed while it has a subscription — cancel it first.",
  },
};

const DEFAULT_MESSAGE =
  "Your change wasn't saved — you may only have view access to this, or it no longer exists. Refresh and try again.";

function isTargetedWrite(url: URL, method: string): string | null {
  if (method !== "PATCH" && method !== "DELETE") return null;
  const m = url.pathname.match(/\/rest\/v1\/([A-Za-z0-9_]+)$/);
  if (!m) return null;
  const id = url.searchParams.get("id");
  return id && id.startsWith("eq.") ? m[1] : null;
}

export function withSilentWriteGuard(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return base(input, init);
    }
    const table = isTargetedWrite(url, method);
    if (!table) return base(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const prefer = headers.get("Prefer");
    if (!prefer || !/count=/.test(prefer))
      headers.set("Prefer", prefer ? `${prefer},count=exact` : "count=exact");
    const res = await base(input, { ...init, headers });
    if (!res.ok) return res;

    // Content-Range: "0-0/1" (one row) or "*/0" (none).
    const total = res.headers.get("Content-Range")?.split("/")[1];
    if (total !== "0") return res;
    const op = method === "DELETE" ? "delete" : "update";
    const message = TABLE_MESSAGES[table]?.[op] ?? DEFAULT_MESSAGE;
    return new Response(
      JSON.stringify({
        code: "PGRST_NO_ROWS",
        message,
        details: `${op} on ${table} matched no rows`,
        hint: null,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  };
}
