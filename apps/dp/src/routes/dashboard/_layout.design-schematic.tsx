import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { siteFit } from "@/lib/site-fit";
import type { SurveyReading } from "@/lib/survey-reading";
import {
  SCHEMATIC_LABEL,
  generateSchematic,
  makeOption,
  saveSchematic,
  siteKey,
  type Schematic,
  type SchematicOption,
} from "@/lib/schematic";
import { Section, Loading } from "@/components/dp-ui";
import { PlanLegend, SitePlanSvg } from "@/components/SitePlan";
import { useActiveDesignRequest, EmptyDesign, designSubtitle } from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-schematic")({
  head: () => ({ meta: [{ title: "Schematic Plan — CorvusDP" }] }),
  component: DesignSchematic,
});

const MAX_OPTIONS = 6;

// Step 4 of the survey workflow: Corvus AI lays out an early concept on the
// confirmed site — building placement and footprint, parking and access,
// open space — always inside the setbacks. Generate, flip between options,
// try a different arrangement or refine it in words.
function DesignSchematic() {
  const { loading, dr, brief, refetch } = useActiveDesignRequest();
  const [busy, setBusy] = useState<"new" | "different" | "refine" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refine, setRefine] = useState("");
  const reading = (dr?.survey_reading ?? null) as SurveyReading | null;
  const fit = useMemo(
    () =>
      dr
        ? siteFit(reading, dr.site_inputs ?? null, {
            buildingArea: dr.building_area,
            floors: dr.floors,
          })
        : null,
    [dr, reading],
  );
  if (loading) return <Loading />;
  if (!dr || !brief || !fit) return <EmptyDesign />;

  const schematic = (dr.schematic ?? null) as Schematic | null;
  const options = schematic?.options ?? [];
  const current: SchematicOption | null = options[schematic?.selected ?? 0] ?? null;
  const ready = !!fit.lot && !!fit.envelope;
  const stale = !!current && current.siteKey !== siteKey(fit);

  async function generate(kind: "new" | "different" | "refine") {
    if (!dr || !fit) return;
    setError(null);
    setBusy(kind);
    try {
      const instruction = kind === "refine" ? refine.trim() || null : null;
      const layout = await generateSchematic({
        designRequestId: dr.id,
        fit,
        reading,
        sector: dr.sector,
        instruction,
        previous: kind === "different" ? current : null,
      });
      const option = makeOption(layout, fit, dr.sector, instruction);
      const next = [...options, option].slice(-MAX_OPTIONS);
      await saveSchematic(dr.id, { options: next, selected: next.length - 1 });
      await refetch();
      if (kind === "refine") setRefine("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Corvus AI couldn't generate the plan.");
    } finally {
      setBusy(null);
    }
  }
  async function select(i: number) {
    if (!dr || !schematic) return;
    await saveSchematic(dr.id, { ...schematic, selected: i });
    await refetch();
  }

  if (!dr.survey_path || !ready)
    return (
      <Section title="Schematic Plan" subtitle={designSubtitle(dr)}>
        <p className="text-sm">
          {!dr.survey_path
            ? "Upload the land survey first — the plan is fitted to your lot."
            : fit.status === "needs_info"
              ? `Confirm the site details first (still needed: ${fit.missing.join(", ").toLowerCase()}).`
              : "The setbacks leave no buildable area on this lot — check the site details."}
        </p>
        <Link to="/dashboard/design-survey" className="btn-accent mt-4 inline-flex text-sm">
          Go to Land Survey
        </Link>
      </Section>
    );

  return (
    <div className="grid gap-5">
      <Section
        title="Schematic Plan"
        subtitle={designSubtitle(dr)}
        right={
          options.length > 0 ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void generate("different")}
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
            >
              {busy === "different" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Try a different layout
            </button>
          ) : null
        }
      >
        <p className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm font-medium">
          {SCHEMATIC_LABEL}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {!current ? (
          <div className="grid place-items-center gap-3 rounded-xl border-2 border-dashed border-border p-10 text-center">
            <Sparkles className="h-8 w-8 text-accent" aria-hidden />
            <p className="max-w-md text-sm text-muted-foreground">
              Corvus AI will place the building on your lot inside the setbacks, with parking,
              access and open space — an early concept to react to.
            </p>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void generate("new")}
              className="btn-accent inline-flex items-center gap-1.5 text-sm"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {busy ? "Generating…" : "Generate schematic plan"}
            </button>
          </div>
        ) : (
          <>
            {options.length > 1 && (
              <div
                className="mb-3 flex flex-wrap gap-1.5"
                role="tablist"
                aria-label="Layout options"
              >
                {options.map((o, i) => (
                  <button
                    key={o.id}
                    type="button"
                    role="tab"
                    aria-selected={i === schematic!.selected}
                    onClick={() => void select(i)}
                    className={`rounded-full border px-3 py-1 text-xs ${i === schematic!.selected ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
                  >
                    Option {i + 1}
                  </button>
                ))}
              </div>
            )}
            {stale && (
              <p className="mb-3 flex gap-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                The site details changed after this plan was made — generate a new one to fit the
                current setbacks.
              </p>
            )}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <figure className="min-w-0">
                <SitePlanSvg
                  fit={fit}
                  reading={reading}
                  schematic
                  idPrefix="plan"
                  layers={{
                    building: current.building,
                    parking: current.parking,
                    driveway: current.driveway,
                    entrance: current.entrance,
                    openSpace: current.openSpace,
                  }}
                />
                <PlanLegend
                  reading={reading}
                  building
                  parking={!!(current.parking || current.driveway)}
                  openSpace={current.openSpace.length > 0}
                />
              </figure>
              <OptionDetails o={current} />
            </div>
          </>
        )}
      </Section>

      {current && (
        <Section
          title="Refine the concept"
          subtitle="Describe what to change and Corvus AI will redo the layout — still inside the setbacks."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={refine}
              onChange={(e) => setRefine(e.target.value)}
              placeholder="e.g. move the building to the rear and put parking along the street"
              aria-label="How to refine the plan"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!!busy || !refine.trim()}
              onClick={() => void generate("refine")}
              className="btn-accent inline-flex items-center justify-center gap-1.5 text-sm"
            >
              {busy === "refine" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden />
              )}
              {busy === "refine" ? "Refining…" : "Refine"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            * Each result is kept as an option (the last {MAX_OPTIONS}) so you can compare them.
          </p>
        </Section>
      )}
    </div>
  );
}

function OptionDetails({ o }: { o: SchematicOption }) {
  const m = o.metrics;
  const row = (k: string, v: React.ReactNode, warn = false) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span
        className={`text-right font-medium tabular-nums ${warn ? "text-amber-700 dark:text-amber-400" : ""}`}
      >
        {v}
      </span>
    </div>
  );
  return (
    <div className="grid content-start gap-4 text-sm">
      <div>
        <div className="font-semibold">{o.title}</div>
        {o.instruction && (
          <div className="text-xs text-muted-foreground">Refined: “{o.instruction}”</div>
        )}
        {o.rationale && <p className="mt-1 text-muted-foreground">{o.rationale}</p>}
      </div>
      <div>
        {row(
          "Footprint",
          `${m.footprintSqFt.toLocaleString()} sf${m.targetFootprintSqFt ? ` of ${m.targetFootprintSqFt.toLocaleString()}` : ""}`,
          !!m.targetFootprintSqFt && m.footprintSqFt < m.targetFootprintSqFt * 0.9,
        )}
        {row("Lot coverage", `${m.coveragePct}%`)}
        {(m.stalls > 0 || m.stallsNeeded) &&
          row(
            "Parking",
            `${m.stalls} stall${m.stalls === 1 ? "" : "s"}${m.stallsNeeded ? ` (about ${m.stallsNeeded} needed)` : ""}`,
            !!m.stallsNeeded && m.stalls < m.stallsNeeded,
          )}
        {m.openSpaceSqFt > 0 && row("Open space", `${m.openSpaceSqFt.toLocaleString()} sf`)}
        {row("Entrance", o.entrance)}
      </div>
      {(o.assumptions.length > 0 || o.adjustments.length > 0) && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assumptions
          </div>
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {o.adjustments.map((a, i) => (
              <li key={`a${i}`} className="text-amber-700 dark:text-amber-400">
                • {a}
              </li>
            ))}
            {o.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
