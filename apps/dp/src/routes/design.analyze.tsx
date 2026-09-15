import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Lock, Sparkles, RotateCcw } from "lucide-react";
import {
  readDpIntake,
  updateDpIntake,
  type DpIntakeState,
  type DesignScope,
  type DesignRequirements,
  type PropertySector,
} from "@/lib/dp-intake";
import { generateDesignBrief, scopeLabel, type DesignBrief } from "@/lib/design";
import { generateDesignNarrative, type DesignNarrative } from "@/lib/ai";
import { currencyRange, weeksLabel } from "@/lib/format";
import { captureLead } from "@/lib/leads";
import { saveDesignRequest } from "@/lib/design-requests";
import { useAuth } from "@/lib/auth";
import { StepRail, Field, inputCls, Section, Stat } from "@/components/dp-ui";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export const Route = createFileRoute("/design/analyze")({
  head: () => ({ meta: [{ title: "Design Brief — CorvusDP" }] }),
  component: DesignAnalyze,
});

const STEPS = ["Property", "Project type", "Requirements", "Brief"];
const SCOPES: { value: DesignScope; label: string }[] = [
  { value: "new_construction", label: "New Construction" },
  { value: "addition", label: "Addition" },
  { value: "remodeling", label: "Remodeling" },
  { value: "interior_fit_out", label: "Interior Fit-Out" },
];

function DesignAnalyze() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<DpIntakeState>(() => ({ ...readDpIntake(), track: "design" }));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Parameters<typeof updateDpIntake>[0]) {
    setState(updateDpIntake({ ...next, track: "design" }));
  }

  const brief = useMemo(
    () => (step >= 3 ? generateDesignBrief(state.design) : null),
    [step, state],
  );

  function go(to: number) {
    const c = Math.max(0, Math.min(3, to));
    patch({ step: Math.max(state.step, c) });
    setStep(c);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handlePrimary() {
    setError(null);
    void captureLead(state, { email: user?.email ?? undefined });
    if (!user) {
      nav({
        to: "/sign-in",
        search: {
          redirect: "/design/analyze",
          mode: "signup",
          reason: "Create an account to save your design brief.",
        },
      });
      return;
    }
    setSaving(true);
    try {
      await saveDesignRequest(user.id, state);
      nav({ to: "/dashboard/design" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the design request.");
      setSaving(false);
    }
  }

  const d = state.design;

  return (
    <div className="container-page py-10 max-w-3xl">
      <span className="badge-soft">Design Brief</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        {step < 3 ? "Define your design intent" : "Your AI-generated design brief"}
      </h1>
      <div className="mt-5">
        <StepRail steps={STEPS} current={step} />
      </div>

      {step === 0 && (
        <Section title="Property" subtitle="Where is the project?">
          <div className="grid gap-4">
            <Field
              label="Property address or city / region"
              required
              hint="Pick a suggestion to fill in county and state automatically."
            >
              <AddressAutocomplete
                ariaLabel="Property address"
                placeholder="123 Lone Star Trail, Celina, TX"
                value={state.property.address ?? state.property.city ?? ""}
                onChange={(v) => patch({ property: { address: v, city: v } })}
                onSelect={(pick) =>
                  patch({
                    property: {
                      address: pick.formatted,
                      city: pick.city ?? pick.formatted,
                      county: pick.county ?? state.property.county,
                      state: pick.state ?? state.property.state,
                    },
                  })
                }
              />
            </Field>
            <Field label="County">
              <input
                className={inputCls}
                value={state.property.county ?? ""}
                onChange={(e) => patch({ property: { county: e.target.value } })}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              className="btn-accent disabled:opacity-50"
              disabled={!state.property.address && !state.property.city}
              onClick={() => go(1)}
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Section>
      )}

      {step === 1 && (
        <Section title="Type of project">
          <div className="grid gap-5">
            <div>
              <div className="text-sm font-medium">Sector</div>
              <div className="mt-2 flex gap-2">
                {(["commercial", "residential"] as PropertySector[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => patch({ design: { sector: s } })}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                      d.sector === s
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border hover:bg-secondary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Scope</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                {SCOPES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => patch({ design: { scope: s.value } })}
                    className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                      d.scope === s.value
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border hover:bg-secondary"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <button className="btn-outline" onClick={() => go(0)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              className="btn-accent disabled:opacity-50"
              disabled={!d.scope}
              onClick={() => go(2)}
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Section>
      )}

      {step === 2 && (
        <Section title="Design requirements & preferences">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Desired building area (sf)" required>
                <input
                  className={inputCls}
                  value={d.buildingArea ?? ""}
                  onChange={(e) => patch({ design: { buildingArea: e.target.value } })}
                />
              </Field>
              <Field label="Number of floors" required>
                <input
                  className={inputCls}
                  value={d.floors ?? ""}
                  onChange={(e) => patch({ design: { floors: e.target.value } })}
                />
              </Field>
              <Field label="Approximate site area" hint="e.g. 1.5 acres or 65,000 sf">
                <input
                  className={inputCls}
                  value={d.approxSiteArea ?? ""}
                  onChange={(e) => patch({ design: { approxSiteArea: e.target.value } })}
                />
              </Field>
            </div>
            <Field
              label="Rooms / spaces"
              hint="Comma-separated, e.g. Lobby, Kitchen, Dining, Offices"
            >
              <input
                className={inputCls}
                value={d.rooms ?? ""}
                onChange={(e) => patch({ design: { rooms: e.target.value } })}
              />
            </Field>
            <Field
              label="Functional requirements"
              hint="e.g. open layout, private offices, retail display"
            >
              <textarea
                className={inputCls}
                rows={2}
                value={d.functionalRequirements ?? ""}
                onChange={(e) => patch({ design: { functionalRequirements: e.target.value } })}
              />
            </Field>
            <Field
              label="Special requirements"
              hint="parking, landscape, sustainability, accessibility"
            >
              <textarea
                className={inputCls}
                rows={2}
                value={d.specialRequirements ?? ""}
                onChange={(e) => patch({ design: { specialRequirements: e.target.value } })}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-between">
            <button className="btn-outline" onClick={() => go(1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              className="btn-accent disabled:opacity-50"
              disabled={!d.buildingArea || !d.floors}
              onClick={() => go(3)}
            >
              Generate brief <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Section>
      )}

      {step === 3 && brief && (
        <div className="grid gap-5">
          <AiDesignNarrative design={d} brief={brief} />

          <Section
            title="What's included in your design"
            subtitle={`${scopeLabel(d.scope)} · ${d.sector ?? "commercial"}`}
          >
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {brief.inclusions.map((i) => (
                <li key={i.title}>
                  <span className="font-medium">{i.title}</span>
                  <p className="text-xs text-muted-foreground">{i.detail}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Timeline">
            <div className="text-2xl font-semibold">
              {weeksLabel(brief.totalWeeksMin, brief.totalWeeksMax)}
            </div>
            <ol className="mt-3 grid gap-2 text-sm">
              {brief.timeline.map((t) => (
                <li key={t.phase} className="rounded-lg border border-border p-3">
                  <span className="font-medium">{t.phase}</span> —{" "}
                  {weeksLabel(t.weeksMin, t.weeksMax)}
                  <p className="text-xs text-muted-foreground">{t.note}</p>
                </li>
              ))}
            </ol>
          </Section>

          <div className="relative">
            <div className={user ? "" : "locked-blur"}>
              <Section title="Budget estimate">
                <div className="text-2xl font-semibold">
                  {currencyRange(brief.budgetLow, brief.budgetHigh)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Design fees, all disciplines. Build cost estimated separately.
                </p>
                <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">
                  {brief.costDrivers.map((c) => (
                    <li key={c}>• {c}</li>
                  ))}
                </ul>
              </Section>
              <Section title="Space plan" className="mt-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {brief.spacePlan.map((z) => (
                    <Stat key={z.zone} label={z.zone} value="" hint={z.note} />
                  ))}
                </div>
              </Section>
            </div>
            {!user && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto card-elev max-w-sm p-6 text-center">
                  <Lock className="mx-auto h-6 w-6 text-accent" />
                  <h3 className="mt-2 font-serif text-lg font-semibold">Save your design brief</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Budget breakdown, full space plan, and a design tracking dashboard.
                  </p>
                  <button className="btn-accent mt-4 w-full" onClick={handlePrimary}>
                    Create account &amp; save
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-between">
            <button className="btn-outline" onClick={() => go(2)}>
              <ArrowLeft className="h-4 w-4" /> Edit inputs
            </button>
            <button
              className="btn-accent disabled:opacity-50"
              disabled={saving}
              onClick={handlePrimary}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : user ? (
                "Save & open design dashboard"
              ) : (
                "Create account & save"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// On-demand — same pattern as permitting's AiFeasibilitySummary: the brief
// underneath is already fully computed for free, this only calls the AI
// when the visitor wants it narrated as prose.
function AiDesignNarrative({ design, brief }: { design: DesignRequirements; brief: DesignBrief }) {
  const [narrative, setNarrative] = useState<DesignNarrative | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setErr(null);
    try {
      const result = await generateDesignNarrative({
        scope: design.scope,
        sector: design.sector,
        approxSiteArea: design.approxSiteArea,
        buildingArea: design.buildingArea,
        floors: design.floors,
        rooms: design.rooms,
        functionalRequirements: design.functionalRequirements,
        specialRequirements: design.specialRequirements,
        inclusions: brief.inclusions,
        budgetLow: brief.budgetLow,
        budgetHigh: brief.budgetHigh,
        timelineWeeksMin: brief.totalWeeksMin,
        timelineWeeksMax: brief.totalWeeksMax,
        costDrivers: brief.costDrivers,
      });
      setNarrative(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate the AI narrative. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section
      title="AI design narrative"
      subtitle="A written scope narrative from the brief below — generated on demand."
    >
      {!narrative && !loading && (
        <button className="btn-accent" onClick={generate}>
          <Sparkles className="h-4 w-4" /> Generate AI narrative
        </button>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Writing your brief…
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {narrative && (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{narrative.scopeSummary}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{narrative.narrative}</p>
          {narrative.designConsiderations.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {narrative.designConsiderations.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent">•</span>
                  <span className="text-muted-foreground">{c}</span>
                </li>
              ))}
            </ul>
          )}
          <button className="btn-outline w-fit text-xs" onClick={generate} disabled={loading}>
            <RotateCcw className="h-3.5 w-3.5" /> Regenerate
          </button>
        </div>
      )}
    </Section>
  );
}
