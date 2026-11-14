// Speed: on page load the header widgets (notifications bell, journey tracker,
// hour-before alert…) and the page itself each ask the database for the same
// rows at the same moment — the dashboard alone sent the identical `profiles`
// read 16 times and `protests` 7 times. Each one is a full round trip to the
// database region, so the page waited on a queue of identical requests.
//
// This wraps the Supabase client's fetch: a GET to the REST API that is
// identical (same URL, same signed-in user, same Accept/Prefer/Range headers)
// to one still in flight shares that request's response instead of sending
// another. Nothing is cached after the response arrives — the next read always
// goes to the database — and any write (POST/PATCH/PUT/DELETE, RPC, function
// call) forgets every in-flight read, so a read started after a save can never
// be answered with data from before it.

const KEY_HEADERS = ["Authorization", "apikey", "Accept", "Prefer", "Range", "Accept-Profile"];

export function withReadDedupe(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  const inflight = new Map<string, Promise<Response>>();
  return (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      inflight.clear();
      return base(input, init);
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Only plain table reads; an abortable request keeps its own lifetime.
    if (!url.includes("/rest/v1/") || init?.signal) return base(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const key = [method, url, ...KEY_HEADERS.map((h) => headers.get(h) ?? "")].join("\n");
    let shared = inflight.get(key);
    if (!shared) {
      const p = base(input, init);
      shared = p;
      inflight.set(key, p);
      const done = () => {
        if (inflight.get(key) === p) inflight.delete(key);
      };
      p.then(done, done);
    }
    // Every caller reads its own copy of the body.
    return shared.then((res) => res.clone());
  };
}
