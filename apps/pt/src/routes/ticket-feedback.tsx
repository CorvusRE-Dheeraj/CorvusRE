import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/edge-functions";

// "How did we do?" from a resolved support ticket's email. No sign-in — the
// link's token names one ticket. Feeds Support analytics (customer feedback).
export const Route = createFileRoute("/ticket-feedback")({
  validateSearch: (s: Record<string, unknown>): { t?: string } => ({
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  head: () => ({
    meta: [{ title: "How did we do? — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  component: TicketFeedback,
});

function TicketFeedback() {
  const { t } = Route.useSearch();
  const [info, setInfo] = useState<{
    number: number;
    subject: string;
    rating: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!t) return setError("This link isn't valid.");
    invokeEdgeFunction<{ number: number; subject: string; rating: number | null }>(
      "bd-console?module=support",
      {
        action: "ticket_feedback",
        token: t,
      },
    )
      .then((r) => {
        setInfo(r);
        if (r.rating) setRating(r.rating);
      })
      .catch(() => setError("This link isn't valid or has expired."));
  }, [t]);
  async function submit() {
    setBusy(true);
    try {
      await invokeEdgeFunction("bd-console?module=support", {
        action: "ticket_feedback",
        token: t,
        rating,
        comment,
      });
      setDone(true);
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-12">
      <div className="card-elev w-full max-w-md p-6 sm:p-8">
        <h1 className="font-serif text-xl font-semibold">How did we do?</h1>
        {error ? (
          <p className="mt-3 text-sm">{error}</p>
        ) : !info ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : done ? (
          <p className="mt-3 text-sm">Thank you — your feedback helps us improve.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Request #{info.number}: {info.subject}
            </p>
            <div className="mt-4 flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => setRating(n)}
                  className="p-1"
                >
                  <Star
                    className={`h-7 w-7 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <textarea
              className="mt-3 min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Anything we could have done better? (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-label="Comment"
            />
            <button
              type="button"
              className="btn-accent mt-3"
              disabled={!rating || busy}
              onClick={submit}
            >
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </>
        )}
        <Link to="/" className="mt-6 block text-sm text-accent underline">
          CorvusPT home
        </Link>
      </div>
    </div>
  );
}
