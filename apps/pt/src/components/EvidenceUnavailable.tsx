import { useState } from "react";
import { ArrowRight, FileX2, Lightbulb, RotateCcw } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  UNAVAILABLE_REASONS,
  reasonLabel,
  type UnavailableReason,
  type UnavailableRecord,
} from "@/lib/evidence-unavailable";

// Module 8's "Document not available" — shown inside a Missing checklist row
// (EvidenceCategoryRow). Before: a link that opens a short reason picker.
// After: the AI's answer — what the gap means, substitutes, how the strategy
// shifts, next steps — plus "I found it" to undo.

export function MarkUnavailable({
  onSubmit,
}: {
  onSubmit: (reason: UnavailableReason, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UnavailableReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <FileX2 className="h-3.5 w-3.5" />I don&apos;t have this document
      </button>
    );
  }

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, note);
    } catch (err) {
      setError(getErrorMessage(err, "Could not get AI guidance. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background/80 p-2.5 text-xs">
      <div className="font-semibold">Evidence not available — why?</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Reason">
        {UNAVAILABLE_REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={reason === r.value}
            disabled={busy}
            onClick={() => setReason(r.value)}
            className={`rounded-full border px-2.5 py-1 ${
              reason === r.value
                ? "border-accent bg-accent/10 font-semibold text-accent"
                : "border-border text-muted-foreground hover:bg-secondary/60"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        disabled={busy}
        rows={2}
        placeholder="Anything else AI should know? (optional — e.g. bought at auction, no closing statement issued)"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
      />
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!reason || busy}
          className="btn-primary text-xs py-1.5 disabled:opacity-60"
        >
          {busy ? "AI is reworking your strategy…" : "Mark not available & get AI guidance"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const IMPACT_TONE = {
  High: "bg-destructive/10 text-destructive",
  Medium: "bg-warning/15 text-warning-foreground",
  Low: "bg-success/15 text-success",
} as const;

export function UnavailableGuidancePanel({
  record,
  onRegenerate,
  onClear,
}: {
  record: UnavailableRecord;
  onRegenerate: () => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"regen" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const g = record.guidance;

  async function run(kind: "regen" | "clear", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background/80 p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold">
          <Lightbulb className="h-3.5 w-3.5 text-accent" />
          Without this document — what AI suggests
        </div>
        {g && (
          <span
            className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${IMPACT_TONE[g.impact]}`}
          >
            {g.impact} impact
          </span>
        )}
      </div>
      <p className="text-muted-foreground">
        Marked not available: {reasonLabel(record.reason)}
        {record.reasonNote ? ` — “${record.reasonNote}”` : ""}
      </p>

      {g ? (
        <>
          {g.impactSummary && <p>{g.impactSummary}</p>}
          {g.strategyChange && (
            <div className="rounded-md bg-accent/5 p-2">
              <span className="font-semibold text-foreground">How your strategy changes: </span>
              <span className="text-muted-foreground">{g.strategyChange}</span>
            </div>
          )}
          {g.alternatives.length > 0 && (
            <div className="grid gap-1.5">
              <div className="font-semibold">Use instead</div>
              {g.alternatives.map((a, i) => (
                <div key={i} className="rounded-md border border-border p-2">
                  <div className="font-medium">{a.evidence}</div>
                  {a.howItHelps && <p className="mt-0.5 text-muted-foreground">{a.howItHelps}</p>}
                  {a.whereToGet && (
                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                      Where to get it: {a.whereToGet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {g.nextSteps.length > 0 && (
            <div className="grid gap-1">
              <div className="font-semibold">What to do now</div>
              <ol className="grid gap-1">
                {g.nextSteps.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-muted-foreground">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            {g.canProceed
              ? "Your protest can still go ahead without this document."
              : "Other evidence is needed before the protest has support — see the steps above."}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">AI guidance isn&apos;t available yet.</p>
      )}

      {error && <p className="text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("regen", onRegenerate)}
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-60"
        >
          <RotateCcw className="h-3 w-3" />
          {busy === "regen" ? "Re-checking…" : "Refresh guidance"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("clear", onClear)}
          className="font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
        >
          {busy === "clear" ? "Updating…" : "I found it — undo"}
        </button>
      </div>
    </div>
  );
}
