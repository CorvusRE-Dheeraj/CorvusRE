import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, CheckCircle2 } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/edge-functions";

// Where the "unsubscribe" link in a reminder email lands (the
// unsubscribe-deadline-reminders / unsubscribe-evidence-reminders functions
// redirect here). No sign-in needed — the link's token is the key. Nothing
// changes on page load: mail scanners open every link in an email, so the
// owner confirms with a click.
type Kind = "deadline" | "assessment" | "evidence";

export const Route = createFileRoute("/reminder-unsubscribe")({
  validateSearch: (s: Record<string, unknown>): { t?: string; kind?: Kind } => ({
    t: typeof s.t === "string" && s.t ? s.t : undefined,
    kind: s.kind === "assessment" || s.kind === "evidence" ? s.kind : "deadline",
  }),
  head: () => ({
    meta: [{ title: "Email reminders — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  component: ReminderUnsubscribe,
});

const WHAT: Record<Kind, { label: string; stays: string }> = {
  deadline: {
    label: "deadline and hearing-date reminder emails",
    stays: "Your deadlines still show on your CorvusPT calendar.",
  },
  assessment: {
    label: "assessment-change emails",
    stays: "Changes still appear on your CorvusPT dashboard.",
  },
  evidence: {
    label: "evidence-reminder emails",
    stays: "Your evidence checklist is still on each case in CorvusPT.",
  },
};

function fnFor(kind: Kind) {
  return kind === "evidence" ? "unsubscribe-evidence-reminders" : "unsubscribe-deadline-reminders";
}

function ReminderUnsubscribe() {
  const { t, kind = "deadline" } = Route.useSearch();
  const what = WHAT[kind];
  const [state, setState] = useState<"loading" | "ready" | "off" | "invalid">("loading");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!t) {
      setState("invalid");
      return;
    }
    invokeEdgeFunction<{ alreadyOff: boolean }>(fnFor(kind), { t, kind, action: "info" })
      .then((r) => setState(r.alreadyOff ? "off" : "ready"))
      .catch(() => setState("invalid"));
  }, [t, kind]);

  async function unsubscribe() {
    if (!t) return;
    setBusy(true);
    try {
      await invokeEdgeFunction(fnFor(kind), { t, kind, action: "unsubscribe" });
      setDone(true);
      setState("off");
    } catch {
      setState("invalid");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-12">
      <div className="card-elev w-full max-w-md p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent">
          <BellOff className="h-4 w-4" aria-hidden /> Email reminders
        </div>
        {state === "loading" ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : state === "invalid" ? (
          <>
            <h1 className="mt-3 font-serif text-xl font-semibold">This link didn&apos;t work</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may be incomplete or no longer valid. You can turn reminder emails on or off any
              time in CorvusPT under Settings → Notification Preferences.
            </p>
            <Link to="/dashboard/settings" className="btn-outline mt-5 inline-flex">
              Open Settings
            </Link>
          </>
        ) : state === "off" ? (
          <>
            <div className="mt-4 flex gap-2 rounded-lg bg-success/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <p>
                {done ? "Done — you" : "You"}&apos;re unsubscribed from {what.label}. {what.stays}
              </p>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Turn them back on any time under Settings → Notification Preferences.
            </p>
            <Link
              to="/dashboard/settings"
              className="mt-4 inline-block text-sm text-accent underline"
            >
              Open Settings
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-serif text-xl font-semibold">Stop {what.label}?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {what.stays} Text-message reminders, if you have them, aren&apos;t affected.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn-accent" disabled={busy} onClick={unsubscribe}>
                {busy ? "Saving…" : "Yes, unsubscribe"}
              </button>
              <Link to="/dashboard/settings" className="btn-outline">
                Keep them
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
