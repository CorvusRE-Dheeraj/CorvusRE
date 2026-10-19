import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import {
  STAGES,
  STAGE_LABEL,
  leadFacts,
  logActivity,
  relDays,
  runAi,
  saveCampaign,
  scoreLead,
  splitDraft,
  summaryForAi,
  type AiRun,
  type Lead,
  type MarketingData,
  type Stage,
} from "@/lib/marketing";
import { Field, inputCls, type Go } from "./shared";

// The AI desk: tell Corvus AI what to work on, over all leads, a segment or one
// lead; review the answer; then act on it (save as a campaign draft, add to a
// lead's history). Nothing changes until you choose an action.
const QUICK: { label: string; prompt: string }[] = [
  {
    label: "Find opportunities",
    prompt:
      "Identify the 5 best conversion opportunities in these leads and why (value, deadline, stage, engagement). For each, the next action.",
  },
  {
    label: "Segment prospects",
    prompt:
      "Group these leads into 3-5 useful marketing segments (who they are, size of each, what message fits them). Suggest which segment to target first.",
  },
  {
    label: "Research properties",
    prompt:
      "For these leads' properties, point out which look most likely to benefit from a protest (high value, approaching deadline, commercial) and what public data to check next for each (appraisal district record, comparable sales, prior protests).",
  },
  {
    label: "Research owners",
    prompt:
      "For these leads, what do we know about the owners and what's missing? Suggest how to enrich each record from public sources (county appraisal district owner records, Secretary of State business filings) — no guessing of personal details.",
  },
  {
    label: "Write content",
    prompt:
      "Write a short marketing email for this audience. Reply as 'Subject: <subject>' then a blank line then a plain-text body under 140 words with one call to action. Use {{first_name}}.",
  },
  {
    label: "Campaign ideas",
    prompt:
      "Recommend 3 campaigns for the next 30 days: audience, message angle, channel, timing, and the metric to watch for each.",
  },
];

function leadTable(leads: Lead[], d: MarketingData): string {
  return leads
    .slice(0, 150)
    .map((l) => {
      const s = scoreLead(l, d.activities).score;
      return `${l.fullName ?? l.email ?? "?"} | ${STAGE_LABEL[l.stage]} | ${l.county ?? "-"} | ${l.propertyType ?? "-"} | value ${l.appraisedValue ?? "-"} | deadline ${l.protestDeadline ?? "-"} | score ${s} | last contact ${relDays(l.lastContactedAt)}`;
    })
    .join("\n");
}

export function AiWorkspace({
  data,
  go,
  reload,
  onAiRun,
}: {
  data: MarketingData;
  go: Go;
  reload: () => Promise<void>;
  onAiRun: (r: AiRun) => void;
}) {
  const [scope, setScope] = useState<"all" | "segment" | "lead">("all");
  const [stages, setStages] = useState<Stage[]>([
    "new",
    "researching",
    "ready",
    "contacted",
    "interested",
    "registered",
  ]);
  const [county, setCounty] = useState("");
  const [leadId, setLeadId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiRun | null>(null);
  const counties = useMemo(
    () => [...new Set(data.leads.map((l) => l.county).filter(Boolean) as string[])].sort(),
    [data.leads],
  );
  const segment = useMemo(
    () =>
      data.leads.filter(
        (l) => (!stages.length || stages.includes(l.stage)) && (!county || l.county === county),
      ),
    [data.leads, stages, county],
  );
  const history = data.aiRuns.filter((r) => r.scope === "workspace");
  const target = scope === "lead" ? data.leads.find((l) => l.id === leadId) : null;

  async function ask(prompt: string) {
    if (!prompt.trim()) return toast.error("Tell Corvus AI what to do.");
    if (scope === "lead" && !target) return toast.error("Choose a lead.");
    setBusy(true);
    try {
      const context =
        scope === "lead"
          ? leadFacts(target!, data.activities, data.followups)
          : scope === "segment"
            ? `Segment: ${segment.length} leads (${stages.map((s) => STAGE_LABEL[s]).join(", ") || "all stages"}${county ? `, ${county} County` : ""}).\nname | stage | county | type | value | deadline | score | last contact\n${leadTable(segment, data)}`
            : `${summaryForAi(data)}\n\nAll leads (name | stage | county | type | value | deadline | score | last contact):\n${leadTable(data.leads, data)}`;
      const r = await runAi({
        scope: "workspace",
        instruction: prompt.trim(),
        context,
        leadId: target?.id ?? null,
      });
      setResult(r);
      onAiRun(r);
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't finish that."));
    } finally {
      setBusy(false);
    }
  }

  const draft = result?.result ? splitDraft(result.result) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-4">
        <section className="card-elev grid gap-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Ask Corvus AI
          </h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to work on">
            {(
              [
                ["all", `All leads (${data.leads.length})`],
                ["segment", `A segment (${segment.length})`],
                ["lead", "One lead"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={scope === v}
                onClick={() => setScope(v)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${scope === v ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === "segment" && (
            <div className="grid gap-2 rounded-md bg-secondary/40 p-3">
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={stages.includes(s)}
                    onClick={() =>
                      setStages((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${stages.includes(s) ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
              <select
                className={inputCls}
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                aria-label="County"
              >
                <option value="">All counties</option>
                {counties.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          {scope === "lead" && (
            <select
              className={inputCls}
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              aria-label="Lead"
            >
              <option value="">Choose a lead…</option>
              {data.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName || l.email}
                  {l.company ? ` — ${l.company}` : ""}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={busy}
                onClick={() => {
                  setInstruction(q.prompt);
                  void ask(q.prompt);
                }}
                className="btn-outline py-1 text-xs disabled:opacity-60"
              >
                {q.label}
              </button>
            ))}
          </div>
          <Field label="Or give your own instruction">
            <textarea
              className={inputCls}
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Which Collin County leads should I call first this week, and what should I say?"
            />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ask(instruction)}
            className="btn-primary btn-primary-hover justify-self-start text-sm disabled:opacity-60"
          >
            {busy ? "Working…" : "Run"}
          </button>
        </section>

        {result && (
          <section className="card-elev p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Result — review before acting</h2>
              <div className="flex flex-wrap gap-2">
                {draft?.subject && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await saveCampaign(null, {
                          name: `AI draft ${new Date().toLocaleDateString()}`,
                          channel: "email",
                          subject: draft.subject,
                          body: draft.body,
                          audience:
                            scope === "segment"
                              ? { stages, counties: county ? [county] : undefined }
                              : scope === "lead" && target
                                ? { leadIds: [target.id] }
                                : { stages: ["ready", "contacted", "interested"] },
                        });
                        await reload();
                        toast.success("Saved as a campaign draft.");
                        go("campaigns");
                      } catch (err) {
                        toast.error(getErrorMessage(err, "Could not save the draft."));
                      }
                    }}
                    className="btn-outline py-1 text-xs"
                  >
                    Save as campaign draft
                  </button>
                )}
                {target && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await logActivity({
                          leadId: target.id,
                          kind: "ai",
                          summary: `Corvus AI: ${result.instruction.slice(0, 60)}`,
                          body: result.result,
                        });
                        await reload();
                        toast.success("Added to the lead's history.");
                      } catch (err) {
                        toast.error(getErrorMessage(err, "Could not save."));
                      }
                    }}
                    className="btn-outline py-1 text-xs"
                  >
                    Add to lead history
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(result.result ?? "").then(
                      () => toast.success("Copied."),
                      () => toast.error("Couldn't copy."),
                    )
                  }
                  className="btn-outline py-1 text-xs"
                >
                  Copy
                </button>
              </div>
            </div>
            <MarkdownLite text={result.result ?? ""} className="mt-3 text-sm" />
          </section>
        )}
      </div>

      <aside className="card-elev h-fit p-4">
        <h2 className="text-sm font-semibold">Recent requests</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Your Corvus AI requests appear here.</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {history.slice(0, 15).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setResult(r)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary/50"
                >
                  <span className="line-clamp-2">{r.instruction}</span>
                  <span className="text-muted-foreground">{relDays(r.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
