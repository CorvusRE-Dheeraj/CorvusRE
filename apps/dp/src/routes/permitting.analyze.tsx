import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, ArrowLeft, Lock, Loader2, Sparkles, RotateCcw } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import {
  readDpIntake,
  updateDpIntake,
  type DpIntakeState,
  type ProjectIntent,
  type PropertySector,
} from "@/lib/dp-intake";
import { runPermittingAnalysis } from "@/lib/analysis";
import { generateFeasibilitySummary, type FeasibilitySummary } from "@/lib/ai";
import { statusLabel } from "@/lib/zoning";
import { groupByCategory } from "@/lib/permits";
import { currency, currencyRange, weeksLabel, monthsFromWeeks } from "@/lib/format";
import { captureLead } from "@/lib/leads";
import { saveProjectFromIntake, findProjectByAddress } from "@/lib/projects";
import { availabilityLabel } from "@/lib/constraints";
import { useAuth } from "@/lib/auth";
import {
  StepRail,
  Field,
  inputCls,
  Pill,
  Stat,
  Section,
  feasibilityTone,
} from "@/components/dp-ui";

export const Route = createFileRoute("/permitting/analyze")({
  head: () => ({ meta: [{ title: "Permitting Analysis — CorvusDP" }] }),
  component: Analyze,
});

const STEPS = ["Property", "Project", "Zoning & Jurisdiction", "Feasibility", "Report"];

const INTENTS: { value: ProjectIntent; label: string }[] = [
  { value: "new_construction", label: "New Construction" },
  { value: "addition", label: "Addition" },
  { value: "remodeling", label: "Remodeling" },
  { value: "site_development", label: "Site Development" },
];

function Analyze() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<DpIntakeState>(() => {
    const s = readDpIntake();
    return { ...s, track: "permitting" };
  });
  const [step, setStep] = useState(state.step && state.step <= 4 ? state.step : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingProjectId, setExistingProjectId] = useState<string | null>(null);
  const [confirmedNew, setConfirmedNew] = useState(false);

  function patch(next: Parameters<typeof updateDpIntake>[0]) {
    const merged = updateDpIntake({ ...next, track: "permitting" });
    setState(merged);
  }

  const analysis = useMemo(() => (step >= 2 ? runPermittingAnalysis(state) : null), [step, state]);

  function go(to: number) {
    const clamped = Math.max(0, Math.min(4, to));
    patch({ step: Math.max(state.step, clamped) });
    setStep(clamped);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSaveOrSignup() {
    setError(null);
    if (!analysis) return;
    // Best-effort lead capture regardless of path.
    void captureLead(state, { email: user?.email ?? undefined });
    if (!user) {
      nav({
        to: "/sign-in",
        search: {
          redirect: "/permitting/analyze",
          mode: "signup",
          reason: "Create an account to save this analysis and unlock the full report.",
        },
      });
      return;
    }
    setSaving(true);
    try {
      // Existing-project detection (PRD 1.1.7.H).
      const existing = await findProjectByAddress(user.id, state.property.address);
      if (existing && !confirmedNew) {
        setExistingProjectId(existing.id);
        setSaving(false);
        return;
      }
      await saveProjectFromIntake(user.id, state, analysis);
      nav({ to: "/dashboard" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the project.");
      setSaving(false);
    }
  }

  return (
    <div className="container-page py-10 max-w-4xl">
      <span className="badge-soft">Permitting Analysis</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        {step < 4 ? "Tell us about the property and project" : "Your permitting report"}
      </h1>
      <div className="mt-5">
        <StepRail steps={STEPS} current={step} />
      </div>

      {step === 0 && <PropertyStep state={state} patch={patch} onNext={() => go(1)} />}
      {step === 1 && (
        <ProjectStep state={state} patch={patch} onBack={() => go(0)} onNext={() => go(2)} />
      )}
      {step === 2 && analysis && (
        <ZoningStep analysis={analysis} onBack={() => go(1)} onNext={() => go(3)} />
      )}
      {step === 3 && analysis && (
        <FeasibilityStep
          analysis={analysis}
          address={state.property.address ?? state.property.city}
          onBack={() => go(2)}
          onNext={() => go(4)}
        />
      )}
      {step === 4 && analysis && (
        <ReportStep
          analysis={analysis}
          property={state.property}
          project={state.project}
          signedIn={!!user}
          saving={saving}
          error={error}
          onBack={() => go(3)}
          onPrimary={handleSaveOrSignup}
        />
      )}

      {existingProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-fade-in">
          <div className="card-elev max-w-sm p-6 text-center">
            <h3 className="font-serif text-lg font-semibold">You already have a project here</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              We found an existing project for this property. Continue it, or start a new one?
            </p>
            <div className="mt-5 grid gap-2">
              <button className="btn-accent" onClick={() => nav({ to: "/dashboard" })}>
                Continue existing project
              </button>
              <button
                className="btn-outline"
                onClick={() => {
                  setExistingProjectId(null);
                  setConfirmedNew(true);
                  setTimeout(handleSaveOrSignup, 0);
                }}
              >
                Create a new project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- steps */

type PatchFn = (next: Parameters<typeof updateDpIntake>[0]) => void;

function PropertyStep({
  state,
  patch,
  onNext,
}: {
  state: ReturnType<typeof readDpIntake>;
  patch: PatchFn;
  onNext: () => void;
}) {
  const [manual, setManual] = useState(state.property.manualEntry ?? false);
  const p = state.property;
  const canContinue = manual ? Boolean(p.city) : Boolean(p.address);

  return (
    <Section
      title="Property identification"
      subtitle="Enter the property address, or site details manually if you don't have one yet."
    >
      {!manual ? (
        <div className="grid gap-4">
          <Field
            label="Property address"
            required
            hint="Start typing and pick a suggestion — city, county and state fill in automatically."
          >
            <div className={inputCls}>
              <AddressAutocomplete
                ariaLabel="Property address"
                placeholder="123 Lone Star Trail, Celina, TX 75009"
                value={p.address ?? ""}
                onChange={(v) => patch({ property: { address: v } })}
                onSelect={(pick) =>
                  patch({
                    property: {
                      address: pick.formatted,
                      city: pick.city ?? p.city,
                      county: pick.county ?? p.county,
                      state: pick.state ?? p.state ?? "TX",
                    },
                  })
                }
              />
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <input
                className={inputCls}
                value={p.city ?? ""}
                onChange={(e) => patch({ property: { city: e.target.value } })}
              />
            </Field>
            <Field label="County">
              <input
                className={inputCls}
                value={p.county ?? ""}
                onChange={(e) => patch({ property: { county: e.target.value } })}
              />
            </Field>
            <Field label="State">
              <input
                className={inputCls}
                value={p.state ?? "TX"}
                onChange={(e) => patch({ property: { state: e.target.value } })}
              />
            </Field>
          </div>
          <Field
            label="Zoning (if known)"
            hint="e.g. C-2, SF-3, MU-1 — leave blank and we'll estimate."
          >
            <input
              className={inputCls}
              value={p.zoning ?? ""}
              onChange={(e) => patch({ property: { zoning: e.target.value } })}
            />
          </Field>
          <button
            className="text-sm text-accent underline underline-offset-2 justify-self-start"
            onClick={() => {
              setManual(true);
              patch({ property: { manualEntry: true } });
            }}
          >
            I don't have an exact address
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City / region" required>
              <input
                className={inputCls}
                value={p.city ?? ""}
                onChange={(e) => patch({ property: { city: e.target.value } })}
              />
            </Field>
            <Field label="County">
              <input
                className={inputCls}
                value={p.county ?? ""}
                onChange={(e) => patch({ property: { county: e.target.value } })}
              />
            </Field>
          </div>
          <Field label="Approximate site area" hint="e.g. 2 acres or 90,000 sf">
            <input
              className={inputCls}
              value={p.approxSiteArea ?? ""}
              onChange={(e) => patch({ property: { approxSiteArea: e.target.value } })}
            />
          </Field>
          <Field label="Zoning (if known)">
            <input
              className={inputCls}
              value={p.zoning ?? ""}
              onChange={(e) => patch({ property: { zoning: e.target.value } })}
            />
          </Field>
          <button
            className="text-sm text-accent underline underline-offset-2 justify-self-start"
            onClick={() => {
              setManual(false);
              patch({ property: { manualEntry: false } });
            }}
          >
            I do have an address
          </button>
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <button className="btn-accent disabled:opacity-50" disabled={!canContinue} onClick={onNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Section>
  );
}

function ProjectStep({
  state,
  patch,
  onBack,
  onNext,
}: {
  state: ReturnType<typeof readDpIntake>;
  patch: PatchFn;
  onBack: () => void;
  onNext: () => void;
}) {
  const pr = state.project;
  return (
    <Section title="Project definition" subtitle="What you're planning to do on the property.">
      <div className="grid gap-5">
        <div>
          <div className="text-sm font-medium">Project intent</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            {INTENTS.map((it) => (
              <button
                key={it.value}
                onClick={() => patch({ project: { intent: it.value } })}
                className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                  pr.intent === it.value
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border hover:bg-secondary"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium">Sector</div>
          <div className="mt-2 flex gap-2">
            {(["commercial", "residential"] as PropertySector[]).map((s) => (
              <button
                key={s}
                onClick={() => patch({ project: { sector: s } })}
                className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  pr.sector === s
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border hover:bg-secondary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Lot size" hint="e.g. 2 acres">
            <input
              className={inputCls}
              value={pr.lotSize ?? ""}
              onChange={(e) => patch({ project: { lotSize: e.target.value } })}
            />
          </Field>
          <Field label="Building area (sf)">
            <input
              className={inputCls}
              value={pr.buildingArea ?? ""}
              onChange={(e) => patch({ project: { buildingArea: e.target.value } })}
            />
          </Field>
          <Field label="Number of floors">
            <input
              className={inputCls}
              value={pr.floors ?? ""}
              onChange={(e) => patch({ project: { floors: e.target.value } })}
            />
          </Field>
        </div>
        {pr.intent === "remodeling" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Existing use">
              <input
                className={inputCls}
                value={pr.existingUse ?? ""}
                onChange={(e) => patch({ project: { existingUse: e.target.value } })}
              />
            </Field>
            <Field label="Proposed use">
              <input
                className={inputCls}
                value={pr.proposedUse ?? ""}
                onChange={(e) => patch({ project: { proposedUse: e.target.value } })}
              />
            </Field>
          </div>
        )}
      </div>
      <div className="mt-6 flex justify-between">
        <button className="btn-outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-accent disabled:opacity-50" disabled={!pr.intent} onClick={onNext}>
          Analyze property <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Section>
  );
}

function ZoningStep({
  analysis,
  onBack,
  onNext,
}: {
  analysis: ReturnType<typeof runPermittingAnalysis>;
  onBack: () => void;
  onNext: () => void;
}) {
  const { zoning, jurisdiction } = analysis;
  return (
    <Section
      title="Property, zoning & jurisdiction"
      subtitle="Retrieved and classified from what you entered."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Zoning classification"
          value={zoning.code || "Not provided"}
          hint={zoning.label}
        />
        <Stat
          label="Governing authority"
          value={jurisdiction.authority}
          hint={`${jurisdiction.level.toUpperCase()} • ${jurisdiction.county} County, ${jurisdiction.state}`}
        />
      </div>
      <div className="mt-4 rounded-lg border border-border p-4">
        <div className="text-sm font-semibold">Reviewing departments</div>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          {jurisdiction.departments.map((d) => (
            <li key={d.name}>
              • <span className="text-foreground">{d.name}</span> — {d.scope}
            </li>
          ))}
        </ul>
      </div>
      {jurisdiction.notes.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {jurisdiction.notes.map((n, i) => (
            <li key={i}>ⓘ {n}</li>
          ))}
        </ul>
      )}
      {!jurisdiction.matched && (
        <p className="mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-xs">
          This jurisdiction isn't in CorvusDP's verified coverage table yet — the analysis is an
          estimate based on typical municipal practice and will be confirmed by a specialist.
        </p>
      )}
      <div className="mt-6 flex justify-between">
        <button className="btn-outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-accent" onClick={onNext}>
          Check feasibility <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Section>
  );
}

function FeasibilityStep({
  analysis,
  address,
  onBack,
  onNext,
}: {
  analysis: ReturnType<typeof runPermittingAnalysis>;
  address?: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const { feasibility, zoning } = analysis;
  return (
    <Section
      title="Feasibility analysis"
      right={
        <Pill tone={feasibilityTone(feasibility.status)}>{statusLabel(feasibility.status)}</Pill>
      }
    >
      <div className="mb-3 grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
        <span>
          <span className="text-muted-foreground">Property: </span>
          {address || "—"}
        </span>
        <span>
          <span className="text-muted-foreground">Zoning: </span>
          {zoning.code || "not provided"} ({zoning.label})
        </span>
        <span>
          <span className="text-muted-foreground">Status: </span>
          {statusLabel(feasibility.status)}
        </span>
      </div>
      <p className="text-sm">{feasibility.summary}</p>
      <div className="mt-2 text-xs text-muted-foreground">
        Confidence: {(feasibility.confidence * 100).toFixed(0)}%
      </div>

      {feasibility.risks.length > 0 && (
        <div className="mt-5 grid gap-3">
          <div className="text-sm font-semibold">Risks &amp; impact</div>
          {feasibility.risks.map((r, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="font-medium">{r.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{r.plainLanguage}</p>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                <span>
                  <span className="text-muted-foreground">Approval: </span>
                  {r.approval}
                </span>
                <span>
                  <span className="text-muted-foreground">Added review: </span>
                  {r.addedReviewMonths[0]}–{r.addedReviewMonths[1]} months
                </span>
                <span>
                  <span className="text-muted-foreground">Added cost: </span>
                  {r.addedCost}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <button className="btn-outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-accent" onClick={onNext}>
          See required permits <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Section>
  );
}

// On-demand — the analysis it narrates is already computed for free
// client-side, so this only calls the AI when the visitor actually wants the
// plain-English version, not automatically on every report view.
function AiFeasibilitySummary({
  analysis,
  property,
  project,
}: {
  analysis: ReturnType<typeof runPermittingAnalysis>;
  property: DpIntakeState["property"];
  project: DpIntakeState["project"];
}) {
  const [summary, setSummary] = useState<FeasibilitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setErr(null);
    try {
      const result = await generateFeasibilitySummary({
        address: property.address,
        city: property.city,
        county: property.county,
        state: property.state,
        intent: project.intent,
        sector: project.sector,
        zoning: analysis.zoning,
        feasibility: analysis.feasibility,
        permits: analysis.permits.map((p) => ({ name: p.name, category: p.category })),
        complexity: analysis.complexity,
        constraints: {
          criticalWarnings: analysis.constraints.criticalWarnings,
          utilities: analysis.constraints.utilities,
        },
      });
      setSummary(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate the AI summary. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section
      title="AI feasibility summary"
      subtitle="A plain-English read of the analysis below — generated on demand, verify with your jurisdiction."
    >
      {!summary && !loading && (
        <button className="btn-accent" onClick={generate}>
          <Sparkles className="h-4 w-4" /> Generate AI summary
        </button>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading your analysis…
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {summary && (
        <div className="grid gap-3">
          <p className="text-sm leading-relaxed">{summary.narrative}</p>
          {summary.keyRisks.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {summary.keyRisks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent">•</span>
                  <span className="text-muted-foreground">{r}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="rounded-lg bg-secondary/60 p-3 text-sm">
            <span className="font-semibold">Next step: </span>
            {summary.recommendedNextStep}
          </p>
          <button
            className="btn-outline w-fit text-xs"
            onClick={generate}
            disabled={loading}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Regenerate
          </button>
        </div>
      )}
    </Section>
  );
}

function ReportStep({
  analysis,
  property,
  project,
  signedIn,
  saving,
  error,
  onBack,
  onPrimary,
}: {
  analysis: ReturnType<typeof runPermittingAnalysis>;
  property: DpIntakeState["property"];
  project: DpIntakeState["project"];
  signedIn: boolean;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onPrimary: () => void;
}) {
  const { permits, complexity, agencies, roadmap, fees, timeline } = analysis;
  const grouped = groupByCategory(permits);

  return (
    <div className="grid gap-5">
      <AiFeasibilitySummary analysis={analysis} property={property} project={project} />

      <Section
        title="Required permits"
        subtitle={`${permits.length} permits · ${complexity.level} complexity · ~${complexity.estimatedReviewCycles} review cycle(s)`}
        right={
          <button type="button" className="btn-outline text-sm" onClick={() => window.print()}>
            Export / print
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="rounded-lg border border-border p-4">
              <div className="text-sm font-semibold">{cat}</div>
              <ul className="mt-2 grid gap-2 text-sm">
                {items.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.name}</span>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Overall complexity" value={complexity.level} />
          <Stat label="Estimated approvals" value={complexity.estimatedApprovals} />
          <Stat label="Estimated review cycles" value={complexity.estimatedReviewCycles} />
        </div>
      </Section>

      <Section title="Reviewing agencies">
        <ul className="grid gap-2 text-sm">
          {agencies.map((a) => (
            <li key={a.permitId} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{a.permitName}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>{a.agency}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Site constraints"
        subtitle="Utilities & constraints to design around (estimate)."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {analysis.constraints.utilities.map((u) => (
            <div
              key={u.name}
              className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm"
            >
              <span className="font-medium">{u.name}</span>
              <Pill
                tone={
                  u.status === "likely_available"
                    ? "green"
                    : u.status === "likely_constrained"
                      ? "red"
                      : "amber"
                }
              >
                {availabilityLabel(u.status)}
              </Pill>
            </div>
          ))}
        </div>
        {analysis.constraints.criticalWarnings.length > 0 && (
          <ul className="mt-3 grid gap-1 text-xs text-red-600">
            {analysis.constraints.criticalWarnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Full constraints list, pre-application meeting agenda, and a downloadable site summary are
          on your dashboard after you save.
        </p>
      </Section>

      <div className="relative">
        <div className={signedIn ? "" : "locked-blur"}>
          <Section title="Permitting roadmap">
            <ol className="grid gap-2">
              {roadmap.map((ph) => (
                <li key={ph.order} className="rounded-lg border border-border p-3 text-sm">
                  <span className="font-semibold">Phase {ph.order}:</span> {ph.title}
                  {ph.parallel && <span className="badge-soft ml-2">parallel</span>}
                </li>
              ))}
            </ol>
          </Section>
          <Section title="Fee estimate" className="mt-4">
            <div className="text-2xl font-semibold">
              {currencyRange(fees.totalLow, fees.totalHigh)}
            </div>
            <p className="text-xs text-muted-foreground">
              Permits {currencyRange(fees.subtotalLow, fees.subtotalHigh)} + impact fees{" "}
              {currency(fees.impactFeesLow)}–{currency(fees.impactFeesHigh)}
            </p>
          </Section>
          <Section title="Timeline estimate" className="mt-4">
            <div className="text-2xl font-semibold">
              {weeksLabel(timeline.totalWeeksMin, timeline.totalWeeksMax)}
            </div>
            <p className="text-xs text-muted-foreground">
              ≈ {monthsFromWeeks(timeline.totalWeeksMin)} –{" "}
              {monthsFromWeeks(timeline.totalWeeksMax)} across {timeline.phases.length} phases
            </p>
          </Section>
        </div>
        {!signedIn && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto card-elev max-w-sm p-6 text-center">
              <Lock className="mx-auto h-6 w-6 text-accent" />
              <h3 className="mt-2 font-serif text-lg font-semibold">Unlock the full report</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Roadmap, per-permit fees, timeline breakdown, city checklists, and a saved project
                dashboard.
              </p>
              <button className="btn-accent mt-4 w-full" onClick={onPrimary}>
                Create account &amp; unlock
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button className="btn-outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex gap-2">
          <Link to="/design" className="btn-outline">
            Also start design
          </Link>
          <button className="btn-accent disabled:opacity-50" disabled={saving} onClick={onPrimary}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : signedIn ? (
              "Save project & open dashboard"
            ) : (
              "Unlock full report"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
