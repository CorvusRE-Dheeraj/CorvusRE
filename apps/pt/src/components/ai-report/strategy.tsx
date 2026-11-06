import { MarkdownLite } from "@/components/MarkdownLite";
import { type StrategyEntry } from "@/lib/ai-report-modules";
import { type DocumentRecord } from "@/lib/documents";
import { type IconColor } from "@/lib/icon-colors";
import { MODULES } from "@/lib/modules";
import { ArrowRight, RefreshCw, Target, Upload, type LucideIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { scoreColor } from "./module-preview";
import { MiniMeter, NumberBadge } from "./visuals";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: strategy.
// Icon for a ranked strategy — reuses the Module's own icon for the 5 fixed
// strategies (so "Comparable Sales" shows the same icon as the Market Value
// module card, etc.) via relatedModules; falls back to a generic icon for an
// AI-added "Other: ..." strategy, which doesn't map to any of Modules 3-7.
export function strategyIcon(s: StrategyEntry): LucideIcon {
  const relatedId = s.relatedModules[0];
  const mod = relatedId ? MODULES.find((mm) => mm.id === relatedId) : undefined;
  return mod?.icon ?? Target;
}

// Stable per-strategy key for tagging uploaded evidence (documents.document_type,
// see handleUploadEvidence in Report()) and storing the free-text evidence-gate
// answer (IntakeState.strategyAnswers) — derived from the AI's own strategy name
// so no separate id/lookup table is needed.
export function strategySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Compact ranked row for the card preview — used by both ModuleVisual's
// "strategy" case and StrategyDetail's header below. Row order itself
// already conveys rank (top = strongest), so no separate number badge.
export function StrategyBar({
  s,
  onUpload,
  uploading,
}: {
  s: StrategyEntry;
  // When provided, a "Data Needed" row shows an inline upload control that
  // tags the file for this strategy (same path as StrategyDetail's own
  // upload) and lets Module 2 re-run with it.
  onUpload?: (s: StrategyEntry, files: File[]) => void;
  uploading?: boolean;
}) {
  const Icon = strategyIcon(s);
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-muted-foreground">{s.name}</div>
        <div className="h-1.5 rounded-full bg-secondary/60">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${s.strengthScore}%`, backgroundColor: scoreColor(s.strengthScore) }}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Score always shows — the row still reads as ranked even when the
            AI wants more evidence. */}
        <span
          className="w-6 text-right text-xs font-semibold"
          style={{ color: s.dataSufficient ? scoreColor(s.strengthScore) : undefined }}
        >
          {s.strengthScore}
        </span>
        {!s.dataSufficient &&
          (onUpload ? (
            // Upload control ONLY on a row the AI flagged as needing data.
            <label
              title="Data needed — upload supporting evidence"
              className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-accent/40 px-2 py-0.5 text-[9px] font-semibold text-accent hover:bg-accent/10 ${
                uploading ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <input
                type="file"
                accept="image/*,.pdf"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => {
                  const sel = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (sel.length > 0) onUpload(s, sel);
                }}
              />
              <Upload className="h-3 w-3" />
              {uploading ? "…" : "Upload"}
            </label>
          ) : (
            <span className="whitespace-nowrap rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">
              Data Needed
            </span>
          ))}
      </div>
    </div>
  );
}

export function StrategyRankList({
  strategies,
  color,
  max,
  onUploadFor,
  uploading,
}: {
  strategies: StrategyEntry[];
  color: IconColor;
  max?: number;
  onUploadFor?: (s: StrategyEntry, files: File[]) => void;
  uploading?: boolean;
}) {
  const shown = max ? strategies.slice(0, max) : strategies;
  return (
    <div className="grid gap-2 [&>*]:min-w-0">
      {shown.map((s) => (
        <StrategyBar key={s.name} s={s} onUpload={onUploadFor} uploading={uploading} />
      ))}
    </div>
  );
}

// Full per-strategy breakdown for the modal — why AI selected it, supporting
// findings, valuation relevance, existing/missing evidence, confidence, and
// recommended investigation, all real fields from the "strategy" MODULE_SPEC
// (see supabase/functions/ai-report-modules/index.ts). When the AI flagged
// dataSufficient false, this also renders the evidence gate: an upload button
// (tagging the file with this strategy via handleUploadEvidence's strategyId
// param) and a free-text answer fallback — if the user supplies neither, the
// score still shows but is marked as an unguaranteed estimate, per the
// non-blocking evidence-gate design (Module 2 never renders an empty state).
export function StrategyDetail({
  s,
  rank,
  color,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  answer,
  onAnswerStrategy,
  onRefresh,
  refreshing,
  onOpenModule,
  onAskQuestion,
}: {
  s: StrategyEntry;
  rank: number;
  color: IconColor;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId: string) => void;
  answer: string | undefined;
  onAnswerStrategy: (strategyId: string, answer: string) => void;
  // Re-runs the whole Strategy module (the AI returns every strategy in one
  // pass — there's no per-strategy call), which is what a user wants after
  // uploading evidence for this one. Same handler as the card's header spinner.
  onRefresh?: () => void;
  refreshing?: boolean;
  // "Recommended investigation" is now a real action, not just a sentence to
  // read: when this strategy maps to one of the 5 fixed modules
  // (relatedModules), clicking it opens that module — same navigation the
  // rest of the report already uses. For an "Other: ..." strategy with no
  // fixed module to point at, it asks the AI directly instead (same Q&A the
  // module's own "Ask AI" box answers with) and shows the answer inline.
  onOpenModule: (moduleId: string) => void;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
}) {
  const Icon = strategyIcon(s);
  const slug = strategySlug(s.name);
  const uploaded = evidenceDocs.filter((d) => d.documentType === `Strategy Evidence: ${slug}`);
  const [draft, setDraft] = useState(answer ?? "");
  const hasAnyEvidence = uploaded.length > 0 || !!answer?.trim();
  const [investigationAnswer, setInvestigationAnswer] = useState<string | null>(null);
  const [askingInvestigation, setAskingInvestigation] = useState(false);
  const relatedModuleId = s.relatedModules[0];

  async function handleInvestigationClick() {
    if (relatedModuleId) {
      onOpenModule(relatedModuleId);
      return;
    }
    if (askingInvestigation || !s.recommendedInvestigation) return;
    setAskingInvestigation(true);
    try {
      const a = await onAskQuestion(
        "strategy",
        `For the "${s.name}" strategy, walk me through this recommended investigation step: ${s.recommendedInvestigation}`,
      );
      setInvestigationAnswer(a);
    } catch {
      setInvestigationAnswer("Couldn't get an answer — please retry.");
    } finally {
      setAskingInvestigation(false);
    }
  }

  return (
    <div className="card-elev min-w-0 p-4">
      <div className="flex items-center gap-2.5">
        <NumberBadge n={rank} color={color} size="sm" />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{s.name}</div>
          {s.primaryReason && (
            <div className="truncate text-xs text-muted-foreground">{s.primaryReason}</div>
          )}
        </div>
        {s.dataSufficient ? (
          <span
            className="shrink-0 font-serif text-lg font-bold"
            style={{ color: scoreColor(s.strengthScore) }}
            title="AI estimate — the CAD value, savings and comparable figures shown elsewhere are computed from county data, not the model."
          >
            {s.strengthScore}
            <span className="ml-1 align-middle text-[9px] font-normal text-muted-foreground">
              AI est.
            </span>
          </span>
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-warning/20 px-2 py-1 text-[10px] font-semibold text-warning-foreground">
            Additional Data Needed
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Re-run strategy analysis"
            aria-label="Re-run strategy analysis"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2.5 text-xs sm:grid-cols-2 [&>div]:min-w-0">
        {s.whySelected && (
          <div>
            <div className="font-semibold text-foreground">Why AI selected it</div>
            <p className="break-words text-muted-foreground">{s.whySelected}</p>
          </div>
        )}
        {s.supportingFindings && (
          <div>
            <div className="font-semibold text-foreground">Supporting findings</div>
            <p className="break-words text-muted-foreground">{s.supportingFindings}</p>
          </div>
        )}
        {s.valuationRelevance && (
          <div>
            <div className="font-semibold text-foreground">Potential valuation relevance</div>
            <p className="break-words text-muted-foreground">{s.valuationRelevance}</p>
          </div>
        )}
        {s.recommendedInvestigation && (
          <div>
            <div className="font-semibold text-foreground">Suggested investigation</div>
            <button
              type="button"
              onClick={handleInvestigationClick}
              disabled={askingInvestigation}
              title={
                relatedModuleId
                  ? `Open ${MODULES.find((mm) => mm.id === relatedModuleId)?.shortName ?? relatedModuleId}`
                  : "Ask AI about this"
              }
              className="mt-0.5 flex items-start gap-1 break-words text-left text-muted-foreground hover:text-accent hover:underline disabled:cursor-default disabled:opacity-60"
            >
              <span>{askingInvestigation ? "Asking…" : s.recommendedInvestigation}</span>
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
            </button>
            {investigationAnswer && (
              <MarkdownLite className="mt-1.5 text-foreground" text={investigationAnswer} />
            )}
          </div>
        )}
      </div>

      {(s.existingEvidence.length > 0 || s.missingEvidence.length > 0) && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 [&>div]:min-w-0">
          {s.existingEvidence.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
                Existing Evidence
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {s.existingEvidence.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {s.missingEvidence.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-warning-foreground">
                Missing Evidence
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {s.missingEvidence.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <MiniMeter value={s.confidencePct} label="Confidence" />
      </div>

      {s.relatedModules.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.relatedModules.map((id) => {
            const relatedModule = MODULES.find((mm) => mm.id === id);
            if (!relatedModule) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenModule(id)}
                title={`Open ${relatedModule.shortName}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/15 hover:text-accent"
              >
                Related: {relatedModule.shortName}
                <ArrowRight className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}

      {!s.dataSufficient && (
        <div className="mt-3 border-t border-border/60 pt-3 print:hidden">
          <div className="text-xs font-semibold text-warning-foreground">
            Additional Data Needed
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload supporting documents or answer below so AI can complete this strategy with real
            evidence.
          </p>
          {uploaded.length > 0 && (
            <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
              {uploaded.map((d) => (
                <li key={d.id}>{d.fileName}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              className={`btn-outline text-xs cursor-pointer ${uploadingEvidence ? "pointer-events-none opacity-60" : ""}`}
            >
              {uploadingEvidence
                ? "Uploading…"
                : uploaded.length > 0
                  ? "Upload More Evidence"
                  : "Upload Evidence"}
              <input
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                disabled={uploadingEvidence}
                onChange={(e) => {
                  const selected = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  if (selected.length > 0) onUploadEvidence(selected, slug);
                }}
              />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Or type an answer instead…"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => onAnswerStrategy(slug, draft.trim())}
              className="btn-outline text-xs disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {!hasAnyEvidence && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              Estimate — not guaranteed, missing evidence.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// A "how the analysis flows" ribbon — User Input → AI Processing →
// Logic/Decision → AI Output → Next Step. Purely a process cue; each step
// carries its own eyebrow (the stage), a short label, and an icon so a
// module can name its own pipeline. The AI-output step is accented.
export function AnalysisPipeline({
  steps,
}: {
  steps: { eyebrow: string; label: string; Icon: LucideIcon; current?: boolean }[];
}) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1 sm:gap-1.5">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div
            className={`flex min-w-[88px] flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 text-center sm:min-w-[120px] sm:gap-1.5 sm:px-3 sm:py-3 ${
              s.current ? "bg-accent/15 ring-1 ring-accent/30" : "bg-secondary/50"
            }`}
          >
            <s.Icon
              className={`h-4 w-4 sm:h-5 sm:w-5 ${s.current ? "text-accent" : "text-muted-foreground"}`}
            />
            <div
              className={`text-[9px] font-bold uppercase leading-none tracking-wide sm:text-[10px] ${
                s.current ? "text-accent" : "text-muted-foreground"
              }`}
            >
              {s.eyebrow}
            </div>
            <div className="text-[10px] font-medium leading-tight text-foreground sm:text-xs">
              {s.label}
            </div>
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground sm:h-4 sm:w-4" />
          )}
        </Fragment>
      ))}
    </div>
  );
}
