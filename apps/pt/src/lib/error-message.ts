// Supabase's PostgrestError (and most other thrown API errors) are plain
// objects with a `.message`, not `instanceof Error` — `err instanceof Error
// ? err.message : fallback` silently discards the real reason (an RLS
// violation, a constraint failure, a network error) and always shows the
// fallback for these, which is most errors this app actually throws.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
