import { vi } from "vitest";

// Minimal stand-in for supabase-js's chainable query builder. Real
// supabase-js query builders are themselves thenable (awaiting them
// without .single() resolves the same { data, error } shape .single()
// does), so this mock supports both call styles: `await supabase.from(x)...`
// and `await supabase.from(x)....single()`. Every chain method is a vi.fn()
// so tests can assert on the exact table/column/filter calls made, not just
// the final result.
export type QueryResult<T = unknown> = { data: T; error: unknown };

export function mockQueryBuilder<T = unknown>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

// `supabase.from(table)` — a vi.fn() so tests can assert which table(s) were
// queried, returning a fresh builder per call (queryResultsByTable keyed by
// table name) or the same builder for every call (single QueryResult).
export function mockSupabaseFrom<T = unknown>(
  resultOrByTable: QueryResult<T> | Record<string, QueryResult>,
) {
  const isByTable =
    resultOrByTable !== null &&
    typeof resultOrByTable === "object" &&
    !("data" in resultOrByTable) &&
    !("error" in resultOrByTable);

  const from = vi.fn((table: string) => {
    const result = isByTable
      ? (resultOrByTable as Record<string, QueryResult>)[table]
      : (resultOrByTable as QueryResult<T>);
    return mockQueryBuilder(result);
  });

  return { from };
}
