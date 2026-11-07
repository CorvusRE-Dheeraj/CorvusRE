import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlarmClock, CheckCircle2, Receipt } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { currency } from "@/lib/intake-store";

// Where a property-tax payment reminder's "Already paid" / "Remind me later"
// buttons land (send-deadline-reminders). No sign-in needed — the link's token
// names one payment. Nothing happens on page load: mail scanners open every
// link in an email, so the owner confirms with a click here.
export const Route = createFileRoute("/payment-reminder")({
  validateSearch: (s: Record<string, unknown>): { t?: string; a?: "paid" | "later" } => ({
    t: typeof s.t === "string" ? s.t : undefined,
    a: s.a === "paid" || s.a === "later" ? s.a : undefined,
  }),
  head: () => ({ meta: [{ title: "Payment reminder — CorvusPT" }] }),
  component: PaymentReminder,
});

type Info = {
  title: string;
  dueDate: string;
  amount: number | null;
  paid: boolean;
  snoozedUntil: string | null;
};

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const ERRORS: Record<string, string> = {
  invalid_link: "This link isn't valid. Open Pay Taxes in CorvusPT to update the payment.",
  expired: "This link has expired. Open Pay Taxes in CorvusPT to update the payment.",
  not_found: "This payment is no longer in your account.",
};

function PaymentReminder() {
  const { t, a } = Route.useSearch();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"paid" | "later" | null>(null);
  const [done, setDone] = useState<"paid" | "later" | null>(null);

  useEffect(() => {
    if (!t) {
      setError(ERRORS.invalid_link);
      return;
    }
    invokeEdgeFunction<Info>("payment-reminder-action", { t, action: "info" })
      .then(setInfo)
      .catch((e) => setError(messageFor(e)));
  }, [t]);

  async function act(action: "paid" | "later") {
    if (!t) return;
    setBusy(action);
    try {
      setInfo(await invokeEdgeFunction<Info>("payment-reminder-action", { t, action }));
      setDone(action);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-12">
      <div className="card-elev w-full max-w-md p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent">
          <Receipt className="h-4 w-4" aria-hidden /> Property tax payment
        </div>
        {error ? (
          <>
            <p className="mt-4 text-sm">{error}</p>
            <Link to="/dashboard/pay-taxes" className="btn-outline mt-5 inline-flex">
              Open Pay Taxes
            </Link>
          </>
        ) : !info ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <h1 className="mt-3 font-serif text-xl font-semibold">{info.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Due {fmtDate(info.dueDate)}
              {info.amount != null ? ` · ${currency(info.amount)}` : ""}
            </p>

            {info.paid ? (
              <div className="mt-5 flex gap-2 rounded-lg bg-success/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <p>
                  {done === "paid" ? "Marked as paid — " : "This is marked as paid — "}
                  no more reminders for it. It shows as paid (reported by you) on Pay Taxes; upload
                  the receipt there to keep a record.
                </p>
              </div>
            ) : info.snoozedUntil && done === "later" ? (
              <div className="mt-5 flex gap-2 rounded-lg bg-secondary p-3 text-sm">
                <AlarmClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>We&apos;ll remind you again around {fmtWhen(info.snoozedUntil)}.</p>
              </div>
            ) : (
              <>
                {info.snoozedUntil && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Reminders paused until {fmtWhen(info.snoozedUntil)}.
                  </p>
                )}
                <p className="mt-5 text-sm">Have you paid this?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn-accent ${a === "paid" ? "ring-2 ring-accent ring-offset-2" : ""}`}
                    disabled={!!busy}
                    onClick={() => act("paid")}
                  >
                    {busy === "paid" ? "Saving…" : "Yes, already paid"}
                  </button>
                  <button
                    type="button"
                    className={`btn-outline ${a === "later" ? "ring-2 ring-accent ring-offset-2" : ""}`}
                    disabled={!!busy}
                    onClick={() => act("later")}
                  >
                    {busy === "later" ? "Saving…" : "Not yet — remind me in 24 hours"}
                  </button>
                </div>
              </>
            )}
            <Link
              to="/dashboard/pay-taxes"
              className="mt-6 inline-block text-sm text-accent underline"
            >
              Open Pay Taxes
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function messageFor(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  for (const k of Object.keys(ERRORS)) if (m.includes(k)) return ERRORS[k];
  return "Something went wrong. Please try again, or update the payment on Pay Taxes.";
}
