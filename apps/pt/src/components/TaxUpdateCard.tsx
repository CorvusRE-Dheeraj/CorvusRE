import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { askAboutDocument } from "@/lib/document-ai";
import { getErrorMessage } from "@/lib/error-message";
import type { PropertyRecord } from "@/lib/properties";
import { STATUS_LABEL, TAG_LABEL, type TaxUpdate } from "@/lib/tax-updates";

const STATUS_TONE: Record<TaxUpdate["status"], string> = {
  enacted_law: "bg-success/15 text-success",
  adopted_rule: "bg-success/15 text-success",
  proposed_rule: "bg-warning/15 text-warning-foreground",
  pending_legislation: "bg-warning/15 text-warning-foreground",
  failed_legislation: "bg-destructive/10 text-destructive",
  notice_guidance: "bg-secondary text-muted-foreground",
};

export function updateAsText(u: TaxUpdate): string {
  return [
    `${u.title} [${STATUS_LABEL[u.status]}]${u.counties.length ? ` (${u.counties.join(", ")})` : " (Texas statewide)"}`,
    `What changed: ${u.whatChanged}`,
    `Effective: ${u.effectiveDate ?? "Not stated"}. Affects: ${u.affects}.`,
    `Why it matters: ${u.whyItMatters}`,
    `Action: ${u.actionNeeded}`,
    `Source: ${u.sourceName} — ${u.sourceUrl}`,
  ].join("\n");
}

// One update, with everything the report promises for each: what changed,
// effective date, who it affects, why it matters, the action that may be needed,
// the official source, its legal status, and whether it may affect the reader's
// own property. "How could this affect me?" asks the AI using only the update's
// text plus the reader's own property/case summary.
export function TaxUpdateCard({
  update,
  affected,
  myContext,
}: {
  update: TaxUpdate;
  affected: PropertyRecord[];
  myContext: string;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function explain() {
    setAsking(true);
    try {
      const { answer: a } = await askAboutDocument({
        question:
          "Explain in plain language how this Texas property-tax update may affect my property or my active case, " +
          "and what I should check. Use only the update text and my property/case summary below. " +
          "Do not give legal advice or predict outcomes; tell me to verify against the official source.",
        context: `UPDATE:\n${updateAsText(update)}\n\nMY PROPERTIES AND CASES:\n${myContext || "(none on file)"}`,
      });
      setAnswer(a);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not explain this update."));
    } finally {
      setAsking(false);
    }
  }

  const rows: [string, string][] = [
    ["What changed", update.whatChanged],
    ["Effective date", update.effectiveDate ?? "Not stated"],
    ["Who / what it affects", update.affects],
    ["Why it matters", update.whyItMatters],
    ["What action may be needed", update.actionNeeded],
  ];

  return (
    <article className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[update.status]}`}
        >
          {STATUS_LABEL[update.status]}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            update.isNew ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground"
          }`}
        >
          {update.isNew ? "New this week" : "Currently posted"}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {update.counties.length ? update.counties.join(", ") : "Texas"}
        </span>
        {update.tags.map((t) => (
          <span key={t} className="text-[10px] text-muted-foreground">
            #{TAG_LABEL[t]}
          </span>
        ))}
      </div>
      <h3 className="mt-2 text-sm font-semibold">{update.title}</h3>

      {affected.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            May Affect Your Property (
            {affected
              .slice(0, 3)
              .map((p) => p.address)
              .join("; ")}
            {affected.length > 3 ? `; +${affected.length - 3} more` : ""})
          </span>
        </p>
      )}

      <dl className="mt-2 grid gap-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="text-foreground/90">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="font-semibold uppercase tracking-wide text-muted-foreground">
            Official source
          </dt>
          <dd>
            <a
              href={update.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              {update.sourceName}
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="ml-2 text-muted-foreground">
              checked {new Date(update.sourceCheckedAt).toLocaleDateString()}
            </span>
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-muted-foreground">
            From the page
          </dt>
          <dd className="italic text-muted-foreground">“{update.quote}”</dd>
        </div>
      </dl>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => void explain()}
          disabled={asking}
          className="btn-outline text-xs py-1 disabled:opacity-60"
        >
          {asking ? "Thinking…" : answer ? "Explain again" : "How could this affect my property?"}
        </button>
        {answer && <MarkdownLite text={answer} className="mt-2 text-xs text-muted-foreground" />}
      </div>
    </article>
  );
}
