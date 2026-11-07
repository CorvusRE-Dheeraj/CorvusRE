import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  getAutoSend,
  listOwnerAlerts,
  previewOwnerAlert,
  reviewOwnerAlert,
  setAutoSend,
  type OwnerAlert,
} from "@/lib/tax-rule-alerts";

// Staff: the owner-facing version of each rule change, waiting for review
// before it goes to every affected owner (or sent already). A Super Admin can
// switch sending to automatic.
export function OwnerAlertQueue({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [alerts, setAlerts] = useState<OwnerAlert[] | null>(null);
  const [auto, setAuto] = useState(false);
  const [reach, setReach] = useState<
    Record<string, { owners: number; properties: number; openCases: number }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    listOwnerAlerts()
      .then(setAlerts)
      .catch(() => setAlerts([]));
    getAutoSend()
      .then(setAuto)
      .catch(() => setAuto(false));
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    for (const a of alerts ?? []) {
      if (a.status === "pending_review" && !reach[a.id])
        previewOwnerAlert(a.id)
          .then((r) => setReach((m) => ({ ...m, [a.id]: r })))
          .catch(() => undefined);
    }
  }, [alerts, reach]);
  if (!alerts) return null;
  const pending = alerts.filter((a) => a.status === "pending_review");
  const done = alerts.filter((a) => a.status !== "pending_review").slice(0, 8);
  async function decide(a: OwnerAlert, approve: boolean) {
    setBusy(a.id);
    try {
      await reviewOwnerAlert(a.id, approve, note);
      setNote("");
      toast.success(approve ? "Approved — sending to affected owners" : "Skipped");
      load();
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Send className="h-4 w-4 text-accent" aria-hidden /> Owner alerts
          </h3>
          <p className="text-xs text-muted-foreground">
            Each change, rewritten for owners from the verified alert (never the internal notes),
            goes to every owner whose properties it applies to — in the app and by email.{" "}
            {auto ? "Sending is automatic." : "Each one waits for a staff approval."}
          </p>
        </div>
        {isSuperAdmin && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) =>
                setAutoSend(e.target.checked)
                  .then(
                    () => (
                      setAuto(e.target.checked),
                      toast.success(
                        e.target.checked
                          ? "Owner alerts send automatically"
                          : "Owner alerts wait for review",
                      )
                    ),
                  )
                  .catch((err) => toast.error(getErrorMessage(err, "Couldn't save.")))
              }
            />
            Send automatically (no review)
          </label>
        )}
      </div>
      {pending.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
      )}
      {pending.map((a) => {
        const r = reach[a.id];
        return (
          <div key={a.id} className="rounded-md bg-secondary/40 p-3 text-sm">
            <div className="font-semibold">{a.title}</div>
            <p className="mt-1">{a.summary}</p>
            <p className="mt-1">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                What changed:
              </span>{" "}
              {a.what_changed}
            </p>
            {a.why_it_matters && (
              <p className="mt-1">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Why it matters:
                </span>{" "}
                {a.why_it_matters}
              </p>
            )}
            {a.recommended_action && (
              <p className="mt-1">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  What to do:
                </span>{" "}
                {a.recommended_action}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {a.effective_date ? `Effective ${a.effective_date} · ` : ""}
              {a.counties.length ? a.counties.join(", ") : "Statewide"} · from {a.alert_ids.length}{" "}
              staff alert{a.alert_ids.length === 1 ? "" : "s"} ·{" "}
              <a href={a.source_url} target="_blank" rel="noreferrer" className="underline">
                {a.source_name}
              </a>
            </p>
            <p className="mt-1 text-xs">
              {r
                ? `Goes to ${r.owners} owner${r.owners === 1 ? "" : "s"} (${r.properties} properties, ${r.openCases} with an open case it affects).`
                : "Counting recipients…"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                placeholder="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Review note"
              />
              <button
                type="button"
                className="btn-accent text-xs"
                disabled={busy === a.id}
                onClick={() => void decide(a, true)}
              >
                Approve &amp; send
              </button>
              <button
                type="button"
                className="btn-outline text-xs"
                disabled={busy === a.id}
                onClick={() => void decide(a, false)}
              >
                Skip
              </button>
            </div>
          </div>
        );
      })}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Recently sent or skipped
          </summary>
          <ul className="mt-2 grid gap-1 text-xs">
            {done.map((a) => (
              <li key={a.id}>
                {a.title} —{" "}
                {a.status === "sent"
                  ? `sent to ${a.recipients} owner${a.recipients === 1 ? "" : "s"} (${a.emails_sent} emails)`
                  : a.status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
