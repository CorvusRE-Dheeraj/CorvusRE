import { useLeaflet } from "@/components/CompsMap";
import { PropertyImage } from "@/components/PropertyImage";
import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type IconColor } from "@/lib/icon-colors";
import { computeDepreciation } from "@/lib/improvement-condition";
import { isItemNotApplicable, type ModuleOverride } from "@/lib/module-overrides";
import { type SiteFactor } from "@/lib/site-condition";
import { type SiteGisResult } from "@/lib/site-gis";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  FileWarning,
  Home,
  Percent,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  BUILDING_CONDITION_TONE,
  PIPELINE_STEPS,
  SITE_FACTOR_STATUS_TONE,
  compactCurrency,
  scoreColor,
} from "./helpers";

import { SpeedometerGauge } from "./module-content";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: visuals.
export function MiniMeter({ value, label }: { value: number; label: string }) {
  const color = scoreColor(value);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-secondary/60">
        <div className="h-2 rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function EvidenceQuadrant({ items }: { items: ModuleResultMap["evidence"]["items"] }) {
  if (items.length === 0) return <div className="text-xs text-muted-foreground">No gaps found</div>;
  const cell = (importance: "High" | "Low", availability: "High" | "Low") =>
    items.filter((i) => i.importance === importance && i.availability === availability);
  const focus = cell("High", "Low");
  const quadrants: { label: string; count: number; tone: string }[] = [
    {
      label: "High Importance · Missing",
      count: focus.length,
      tone: "bg-destructive/10 text-destructive",
    },
    {
      label: "High Importance · Available",
      count: cell("High", "High").length,
      tone: "bg-success/10 text-success",
    },
    {
      label: "Low Importance · Missing",
      count: cell("Low", "Low").length,
      tone: "bg-warning/15 text-warning-foreground",
    },
    {
      label: "Low Importance · Available",
      count: cell("Low", "High").length,
      tone: "bg-secondary/60 text-muted-foreground",
    },
  ];
  return (
    <div>
      <div className="flex gap-1">
        <div className="flex w-3 shrink-0 items-center justify-center">
          <span
            className="whitespace-nowrap text-[7px] uppercase tracking-wide text-muted-foreground"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Importance
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-1.5">
            {quadrants.map((q) => (
              <div key={q.label} className={`rounded-md px-2 py-1.5 ${q.tone}`}>
                <div className="text-[8px] font-semibold uppercase tracking-wide">{q.label}</div>
                <div className="text-lg font-bold leading-tight">{q.count}</div>
              </div>
            ))}
          </div>
          <div className="mt-0.5 text-center text-[7px] uppercase tracking-wide text-muted-foreground">
            Availability
          </div>
        </div>
      </div>
      {focus.length > 0 && (
        <div className="mt-1.5 min-w-0 flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive">
          <span className="min-w-0 flex-1 truncate">
            Focus Here First: {focus.map((i) => i.item).join(", ")}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </div>
      )}
      {(() => {
        // New model, when the AI actually populated status/priority: how many
        // items are already verified vs. how many Critical ones still need
        // gathering. Falls back to nothing when only the legacy shape exists.
        const verified = items.filter((i) => i.status && i.status !== "Missing").length;
        const criticalMissing = items.filter(
          (i) => i.priority === "Critical" && i.status === "Missing",
        ).length;
        if (!items.some((i) => i.status)) return null;
        return (
          <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
            {verified} verified · {criticalMissing} critical to gather
          </div>
        );
      })()}
    </div>
  );
}

export function FormulaIcon({
  Icon,
  value,
  label,
  tone,
}: {
  Icon: LucideIcon;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-center leading-tight">
        <div className="text-sm font-bold">{value}</div>
        <div className="text-[9px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function FormulaChain({
  reduction,
  ratePct,
  savings,
}: {
  reduction: number;
  ratePct: number;
  savings: number;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <FormulaIcon
        Icon={Home}
        value={compactCurrency(reduction)}
        label="value reduction"
        tone="bg-sky-500/15 text-sky-700"
      />
      <span className="text-sm text-muted-foreground">×</span>
      <FormulaIcon
        Icon={Percent}
        value={`${ratePct}%`}
        label="tax rate"
        tone="bg-warning/20 text-warning-foreground"
      />
      <span className="text-sm text-muted-foreground">=</span>
      <FormulaIcon
        Icon={DollarSign}
        value={compactCurrency(savings)}
        label="savings"
        tone="bg-success/15 text-success"
      />
    </div>
  );
}

// Module 10's Executive Summary tile — one real number/label per stat, see
// getExecutiveSummary() in src/lib/executive-summary.ts for the source of
// every value passed in here.
export function ExecutiveStat({ label, value }: { label: string; value: string }) {
  // min-w-0 on the grid-item wrapper itself, not just truncate on the
  // children — a grid item's default auto min-width is based on its
  // content, so a long uppercase label like "EVIDENCE READINESS" can still
  // force this cell (and the whole row) wider than the modal without it.
  // Same bug class fixed across the shared row components earlier; this one
  // was added afterward for Module 10 and got missed.
  return (
    <div className="min-w-0 rounded-lg bg-secondary/40 px-2 py-2 text-center">
      <div className="truncate text-[8px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs font-semibold">{value}</div>
    </div>
  );
}

// One row of Module 4's 14-factor table. status is server-enforced (see
// enforceSiteFactorRealData) — this component just renders whatever it's
// given, never re-decides Confirmed/Partial/Additional Data Needed itself.
export function SiteFactorRow({
  factor,
  onOpenModule,
}: {
  factor: SiteFactor;
  onOpenModule: (moduleId: string) => void;
}) {
  return (
    <div className="card-elev p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{factor.factor}</span>
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${SITE_FACTOR_STATUS_TONE[factor.status]}`}
            >
              {factor.status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{factor.finding}</p>
        </div>
        {factor.severity !== "Unknown" && (
          <span className="shrink-0 whitespace-nowrap text-[9px] font-semibold text-muted-foreground">
            {factor.severity}
          </span>
        )}
      </div>
      {factor.evidenceNeeded && (
        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {factor.evidenceNeeded}
          </span>
          <button
            onClick={() => onOpenModule("evidence")}
            className="shrink-0 whitespace-nowrap text-accent hover:underline"
          >
            Upload →
          </button>
        </div>
      )}
    </div>
  );
}

// One tile of the compact "Needs More Data" grid — deliberately just an
// icon + the factor's name, no paragraph, no per-item AI text visible at
// a glance (evidenceNeeded is still there as a hover title for anyone who
// wants it). The same generic icon on every tile, same rationale as
// ChecklistIconRows: nothing here is a specific categorized finding, so no
// icon should look like one. The icon/name still taps through to Module 8
// for full context; the two real actions — N/A and a direct per-factor
// Upload (tagged "Site: <factor>", same convention Site's own auto-upload
// already recognizes) — are both right here, so neither needs that detour.
export function SiteFactorGapTile({
  factor,
  onOpenModule,
  onMarkNotApplicable,
  onUpload,
  uploading,
}: {
  factor: SiteFactor;
  onOpenModule: (moduleId: string) => void;
  // No document exists for most of these 14 factors at all (see
  // enforceSiteFactorRealData) — this is the escape hatch so the card
  // isn't a permanent dead end when there's genuinely nothing to upload.
  onMarkNotApplicable: () => void;
  onUpload: (factor: SiteFactor, files: File[]) => void;
  uploading?: boolean;
}) {
  return (
    <div
      title={factor.evidenceNeeded ?? undefined}
      className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-1.5 py-2 text-center transition-colors hover:border-accent hover:bg-secondary/40"
    >
      <button
        type="button"
        onClick={() => onOpenModule("evidence")}
        className="flex flex-col items-center gap-1"
      >
        <FileWarning className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2 text-[10px] font-medium leading-tight">{factor.factor}</span>
      </button>
      <div className="flex items-center gap-1 text-[9px] font-medium">
        <button
          type="button"
          onClick={onMarkNotApplicable}
          className="text-muted-foreground underline decoration-dotted hover:text-foreground"
        >
          N/A
        </button>
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <label
          className={`cursor-pointer text-accent underline decoration-dotted hover:text-accent/80 ${
            uploading ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {uploading ? "…" : "Upload"}
          <input
            type="file"
            accept="image/*,.pdf"
            multiple
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const sel = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (sel.length > 0) onUpload(factor, sel);
            }}
          />
        </label>
      </div>
    </div>
  );
}

// The "Marked Not Applicable" counterpart — same tile shape, neutral
// checkmark instead of the warning icon, with an Undo back to the gap
// tile above in case the user marked one by mistake or later finds the
// document after all.
export function SiteFactorNotApplicableTile({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary/30 px-1.5 py-2 text-center">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="line-clamp-2 text-[10px] font-medium leading-tight text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-[9px] font-medium text-accent hover:underline"
      >
        Undo
      </button>
    </div>
  );
}

// One row of Module 5's Building Condition Overview. condition/hasPhoto/
// notApplicable are server-enforced (see enforceBuildingComponentRealData)
// — this component just renders whatever it's given, never re-decides "no
// photo" itself.
export function BuildingComponentRow({
  c,
  onUploadClick,
  onMarkNotApplicable,
  onClearNotApplicable,
}: {
  c: ModuleResultMap["improvement"]["buildingComponents"][number];
  // Optional — the modal already has the "Add Evidence" upload section in
  // the same view, so its rows render without a redundant button; the
  // card's rows pass onOpen (opens this module's own modal, where that
  // section lives).
  onUploadClick?: () => void;
  // Optional for the same reason — only the modal's rows offer the N/A
  // escape hatch, matching onUploadClick's own pattern.
  onMarkNotApplicable?: () => void;
  onClearNotApplicable?: () => void;
}) {
  return (
    <div className="card-elev p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{c.component}</span>
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${c.notApplicable ? "bg-secondary/60 text-muted-foreground" : BUILDING_CONDITION_TONE[c.condition]}`}
            >
              {c.hasPhoto ? c.condition : c.notApplicable ? "Not Applicable" : "No Photo Provided"}
            </span>
          </div>
          {c.hasPhoto ? (
            <>
              {c.notes && <p className="mt-0.5 text-xs text-muted-foreground">{c.notes}</p>}
              {c.actionNeeded && (
                <p className="mt-0.5 text-xs font-medium text-foreground/80">{c.actionNeeded}</p>
              )}
            </>
          ) : c.notApplicable ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Marked not applicable — no photo available for this component.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upload a photo showing the {c.component.toLowerCase()} to assess condition.
            </p>
          )}
        </div>
      </div>
      {!c.hasPhoto && c.notApplicable && onClearNotApplicable && (
        <button
          onClick={onClearNotApplicable}
          className="mt-1.5 text-xs text-accent hover:underline"
        >
          Undo — I can upload a photo
        </button>
      )}
      {!c.hasPhoto && !c.notApplicable && (onUploadClick || onMarkNotApplicable) && (
        <div className="mt-1.5 flex items-center gap-3">
          {onUploadClick && (
            <button onClick={onUploadClick} className="text-xs text-accent hover:underline">
              Upload Photo →
            </button>
          )}
          {onMarkNotApplicable && (
            <button
              onClick={onMarkNotApplicable}
              className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              Mark Not Applicable
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Compact, interactive Module 5 (Improvement Condition) card visual — the 4
// building components with their real photo-grounded status, an inline
// per-component photo upload (uploads a general improvement photo, tagged
// EVIDENCE_DOCUMENT_TYPE; the AI matches it to a component), the condition-
// priority gauge, and the depreciation / value-impact numbers once they can
// actually be computed. Nothing here is a guessed condition.
export function ImprovementCardVisual({
  d,
  depreciation,
  address,
  overrides,
  uploading,
  onUpload,
  onOpen,
}: {
  d: ModuleResultMap["improvement"];
  depreciation: ReturnType<typeof computeDepreciation>;
  address?: string | null;
  overrides: ModuleOverride[];
  uploading?: boolean;
  onUpload?: (files: File[]) => void;
  onOpen: () => void;
}) {
  const withPhoto = d.buildingComponents.filter((c) => c.hasPhoto);
  const needsAttention = withPhoto.filter((c) => c.condition !== "Good");
  const missing = d.buildingComponents.filter(
    (c) => !c.hasPhoto && !isItemNotApplicable(overrides, "improvement", c.component),
  ).length;
  return (
    <div className="grid gap-2">
      {/* Real Street View photo of the subject property when Google has
          outdoor imagery there; a generic building illustration otherwise. */}
      <PropertyImage
        address={address}
        width={480}
        height={200}
        className="mx-auto h-24 w-full max-w-[260px] rounded-lg border border-border object-cover"
        fallback={<BuildingIllustration className="mx-auto h-16 w-auto" />}
      />
      <div className="grid gap-1">
        {d.buildingComponents.map((c) => {
          const na = !c.hasPhoto && isItemNotApplicable(overrides, "improvement", c.component);
          const label = c.hasPhoto ? c.condition : na ? "Not Applicable" : "No photo";
          return (
            <div
              key={c.component}
              className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1"
            >
              <span className="text-xs font-medium">{c.component}</span>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  na
                    ? "bg-secondary/60 text-muted-foreground"
                    : BUILDING_CONDITION_TONE[c.condition]
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* One upload for the whole card — the AI reads each photo/doc and
          matches it to the right building component (Roof / HVAC / Exterior /
          Interior); the modal is where a file can be tagged to a component by
          hand. */}
      {onUpload && missing > 0 && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the label wraps a focusable file <input>; the handlers only stop the click from bubbling to the card that opens the modal.
        <label
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={`mx-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10 ${
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
              if (sel.length > 0) onUpload(sel);
            }}
          />
          <Upload className="h-3 w-3" />
          {uploading ? "Uploading…" : "Upload photos"}
        </label>
      )}

      {depreciation.conditionAdjustedValue != null ? (
        <div className="grid grid-cols-2 gap-1.5">
          <ExecutiveStat
            label="Total Depreciation"
            value={`${depreciation.totalDepreciationPct}%`}
          />
          <ExecutiveStat label="Value Impact" value={`${depreciation.impactPct}%`} />
        </div>
      ) : (
        <p className="text-center text-[10px] text-muted-foreground">
          {missing > 0
            ? `Condition photos needed for ${missing} component${missing === 1 ? "" : "s"} to compute depreciation.`
            : "Additional data needed to compute depreciation."}
        </p>
      )}
      {needsAttention.length > 0 && (
        <p className="text-center text-[10px] text-muted-foreground">
          {needsAttention.length} of {withPhoto.length} photographed components need attention
        </p>
      )}

      <div className="flex flex-col items-center">
        <SpeedometerGauge value={d.priorityScore} size="sm" />
        <div className="-mt-1 text-xs text-muted-foreground">condition priority</div>
      </div>

      {d.keyFinding && (
        <button
          type="button"
          onClick={onOpen}
          className="text-left text-[11px] leading-snug text-muted-foreground hover:text-foreground"
        >
          {d.keyFinding}
        </button>
      )}
    </div>
  );
}

export function PipelineDiagram() {
  return (
    <div className="grid grid-cols-5 gap-1">
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step.label} className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center gap-1">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary/60 text-muted-foreground">
              <step.icon className="h-3.5 w-3.5" />
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <ArrowRight className="hidden h-3 w-3 shrink-0 text-muted-foreground sm:block" />
            )}
          </div>
          <div className="text-[9px] font-semibold uppercase tracking-wide">{step.label}</div>
          <div className="line-clamp-2 text-[8px] leading-tight text-muted-foreground">
            {step.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Reference-infographic chrome shared by every module: a
// numbered badge (ModuleCard header + modal header) and a one-line colored
// insight banner on each card, derived from data already loaded elsewhere
// in this file — no new AI calls, just a deterministic read of state that's
// already here (score thresholds, sorted factors, etc.).
export function NumberBadge({
  n,
  color,
  size = "sm",
}: {
  n: number;
  color: IconColor;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "h-8 w-8 text-sm" : "h-5 w-5 text-[10px]";
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${dim}`}
      style={{ backgroundColor: color.solid }}
    >
      {n}
    </span>
  );
}

// Full-bleed band flush with the card's own edges (the card is
// overflow-hidden so this never pokes past its rounded corners) — matches
// the reference infographic's solid colored footer bars, rather than an
// inset rounded pill floating inside the card's padding.
// Clickable — this band is the card's primary "open the full module"
// affordance now that the separate "View report" button is gone. The whole
// strip is the hit target; the arrow nudges right on hover to read as a link.
export function InsightBanner({
  text,
  color,
  onClick,
}: {
  text: string;
  color: IconColor;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left text-sm font-semibold transition-[filter] hover:brightness-95 ${color.bg} ${color.text}`}
    >
      <span className="min-w-0 flex-1 truncate group-hover:underline">{text}</span>
      <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
    </button>
  );
}

// Generic icon+text row for free-text AI checklist items (Improvement
// Condition — Site Condition moved to a real structured 14-factor table,
// see SiteFactorRow) — deliberately the SAME icon for every row rather than
// guessing a specific category from unstructured text the AI never actually
// categorized.
// Real satellite thumbnail for Site Condition, reusing the subject
// property's own coordinates — already loaded for every visitor via the
// comps fetch (see loadCompsMap() in Report()), not a second API call.
// Only renders when that data exists (TrueProdigy-backed counties only,
// same real-data gate CompsMap/CompsValueScatter already use); Site Condition
// falls back to just the checklist rows everywhere else. Esri World
// Imagery is a free, no-API-key satellite tile source, attributed per its
// terms the same way CompsMap already attributes OpenStreetMap.
export function SiteMapThumb({
  lat,
  lng,
  height = 140,
}: {
  lat: number;
  lng: number;
  height?: number;
}) {
  const mods = useLeaflet();
  if (!mods) {
    return (
      <div
        className="animate-pulse rounded-lg border border-border bg-secondary/40"
        style={{ height }}
      />
    );
  }
  const { L, MapContainer, TileLayer, Marker } = mods;
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:var(--accent);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  // Leaflet's default attribution control (including its "Leaflet" link and
  // built-in donation flag icon) is sized for a full map, not an 80px card
  // thumbnail — at that size it visually swallows most of the tile image.
  // Below that threshold we drop the control and show a minimal text credit
  // instead, which still satisfies Esri's attribution requirement; the
  // larger 220px modal map keeps Leaflet's normal control.
  const compact = height < 150;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border" style={{ height }}>
      <MapContainer
        center={[lat, lng]}
        zoom={17}
        zoomControl={false}
        attributionControl={!compact}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        <Marker position={[lat, lng]} icon={icon} />
      </MapContainer>
      {compact && (
        <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/45 px-1 text-[8px] leading-tight text-white">
          Tiles © Esri
        </span>
      )}
    </div>
  );
}

// A generic multi-story commercial building — deliberately not a photo or a
// rendering of THIS specific property (this app has no building imagery for
// any property, and Street View Static API isn't enabled on this project's
// Google Cloud key — confirmed live, not something to fake). A static
// illustration instead, made to actually read as a building: two lit faces
// (front + side, gradient-shaded for depth) with mullioned, reflective
// windows, a stepped rooftop with a mechanical unit and cornice line, an
// entrance canopy over real double doors, and a soft ground shadow.
// Colored entirely from the app's own theme tokens, gradients included, so
// it never needs its own light/dark variant.
export function BuildingIllustration({ className }: { className?: string }) {
  const windowRows = [26, 38, 50, 62, 74];
  const windowCols = [25, 39, 53];
  return (
    <svg viewBox="0 0 120 105" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bldgFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--card)" />
          <stop offset="100%" stopColor="var(--secondary)" />
        </linearGradient>
        <linearGradient id="bldgSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0.48" />
        </linearGradient>
        <linearGradient id="bldgGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id="bldgShadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--border)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--border)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="57" cy="97" rx="48" ry="6" fill="url(#bldgShadow)" />

      {/* Roof */}
      <polygon points="19,26 65,26 91,15 45,15" fill="var(--border)" />
      <polygon points="19,26 65,26 63,29 21,29" fill="var(--muted-foreground)" opacity="0.25" />
      <rect x="48" y="8" width="14" height="8" rx="1" fill="var(--border)" />
      <rect
        x="50"
        y="6"
        width="10"
        height="3"
        rx="0.5"
        fill="var(--muted-foreground)"
        opacity="0.4"
      />
      <line x1="77" y1="15" x2="77" y2="4" stroke="var(--muted-foreground)" strokeWidth="1.25" />
      <circle cx="77" cy="4" r="1.5" fill="var(--muted-foreground)" opacity="0.6" />

      {/* Side face */}
      <polygon points="65,26 91,15 91,85 65,96" fill="url(#bldgSide)" />
      <polygon points="65,26 91,15 91,20 65,31" fill="var(--muted-foreground)" opacity="0.15" />

      {/* Front face */}
      <rect x="19" y="26" width="46" height="70" fill="url(#bldgFront)" />
      <rect
        x="19"
        y="26"
        width="46"
        height="70"
        fill="none"
        stroke="var(--border)"
        strokeWidth="0.75"
      />
      {/* Cornice */}
      <rect x="19" y="26" width="46" height="3" fill="var(--border)" />

      {windowRows.map((y) =>
        windowCols.map((x) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="9" height="8" rx="0.5" fill="url(#bldgGlass)" />
            <line
              x1={x + 4.5}
              y1={y}
              x2={x + 4.5}
              y2={y + 8}
              stroke="var(--card)"
              strokeWidth="0.5"
              opacity="0.6"
            />
            <line
              x1={x}
              y1={y + 4}
              x2={x + 9}
              y2={y + 4}
              stroke="var(--card)"
              strokeWidth="0.5"
              opacity="0.6"
            />
            <line
              x1={x + 1}
              y1={y + 1}
              x2={x + 3.5}
              y2={y + 1}
              stroke="var(--card)"
              strokeWidth="0.8"
              opacity="0.7"
            />
          </g>
        )),
      )}

      {/* Entrance canopy + double doors */}
      <rect x="32" y="85" width="22" height="2" fill="var(--border)" />
      <rect
        x="35"
        y="87"
        width="8"
        height="9"
        rx="0.5"
        fill="var(--muted-foreground)"
        opacity="0.55"
      />
      <rect
        x="43"
        y="87"
        width="8"
        height="9"
        rx="0.5"
        fill="var(--muted-foreground)"
        opacity="0.55"
      />
      <line x1="43" y1="87" x2="43" y2="96" stroke="var(--border)" strokeWidth="0.75" />
    </svg>
  );
}

// Real FEMA flood zone, floated over the site map's corner — a point fact
// (this app has no parcel boundary to shade an actual overlay polygon with),
// never shown at all when siteGis hasn't resolved a real zone (see
// loadSiteGis() in Report()). Colored by inSFHA — the real Special Flood
// Hazard Area boolean FEMA returns, not a guess.
export function FloodZoneBadge({
  floodZone,
}: {
  floodZone: SiteGisResult["floodZone"] | undefined;
}) {
  if (!floodZone) return null;
  return (
    <div
      className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white shadow ${
        floodZone.inSFHA ? "bg-destructive" : "bg-success"
      }`}
      title={floodZone.label}
    >
      Zone {floodZone.zone}
    </div>
  );
}

// Card's condensed constraint -> impact chain (the card's own version of
// Module 4's full "AI Impact Analysis" flow in the modal) — only ever built
// from a factor that pickHeadlineFactor() already confirmed has real/partial
// data, so this never shows a fabricated finding.
// Card's own version of the reference's "AI Impact Analysis" vertical
// arrow chain — built entirely from the SAME real structured fields the
// modal's table shows for this one factor (finding -> potentialImpact ->
// a severity-derived relevance label -> evidenceNeeded as the recommended
// next step), not new AI output. Only ever called with a factor
// pickHeadlineFactor() already confirmed has real/partial data.
export function SiteImpactChain({ factor }: { factor: SiteFactor }) {
  const tone =
    factor.severity === "High"
      ? "text-destructive"
      : factor.severity === "Moderate"
        ? "text-warning-foreground"
        : "text-success";
  const relevance =
    factor.severity === "High"
      ? "High Valuation Relevance"
      : factor.severity === "Moderate"
        ? "Moderate Valuation Relevance"
        : "Low Valuation Relevance";
  const steps: { text: string; tone?: string }[] = [
    { text: `${factor.factor}: ${factor.finding}`, tone },
    ...(factor.potentialImpact ? [{ text: factor.potentialImpact }] : []),
    { text: relevance, tone },
    ...(factor.evidenceNeeded ? [{ text: `Next: ${factor.evidenceNeeded}` }] : []),
  ];
  return (
    <div className="grid gap-0.5">
      {steps.map((step, i) => (
        <div key={i} className="grid justify-items-center gap-0.5">
          {i > 0 && <ArrowDown className="h-2.5 w-2.5 text-muted-foreground" />}
          <div
            className={`w-full truncate rounded-md bg-secondary/40 px-1.5 py-1 text-center text-[9px] font-medium ${step.tone ?? "text-foreground"}`}
            title={step.text}
          >
            {step.text}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChecklistIconRows({ items, color }: { items: string[]; color: IconColor }) {
  return (
    <div className="grid gap-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5">
          <span
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${color.bg} ${color.text}`}
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
          <span className="min-w-0 flex-1 line-clamp-2 text-xs">{item}</span>
        </div>
      ))}
    </div>
  );
}
