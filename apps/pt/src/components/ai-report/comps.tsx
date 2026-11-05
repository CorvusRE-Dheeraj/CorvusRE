import { type CompProperty } from "@/lib/cad-comps";
import { getCadRecordUrl, isDirectCadRecordUrl } from "@/lib/cad-record-url";
import { type CompSaleExtraction, type CompSelectionInput } from "@/lib/comp-selections";
import {
  TOP_N_FOR_INDICATED_VALUE,
  type ComparableStats,
  type RankedComp,
} from "@/lib/comps-analysis";
import { geocodeAddress } from "@/lib/geocode";
import { currency } from "@/lib/intake-store";
import { ArrowRight, Upload } from "lucide-react";
import { Fragment, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { scoreColor } from "./module-preview";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: comps.
// Compact "$4.8M"/"$120K" formatting for tight badge/axis labels where the
// full currency() output (e.g. "$4,800,000") would overflow.
export function compactCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return currency(n);
}

// Real 2-D scatter — Value Per Acre (Y) vs Land Size (X), the honest
// per-unit substitute for a "$/SF vs. building size" plot: no building-SF
// field exists anywhere in this pipeline (see valuePerAcre() below), but
// legalAcreage and marketValue are both real CAD fields every comp already
// carries. The subject renders as a larger, labeled accent dot among the
// comps (muted) so where the subject sits in the market reads at a glance,
// same visual language as CompsMap's subject/comp marker distinction.
// Subject dot shape shared by both the 2-D and 1-D fallback charts below —
// a larger accent-colored, labeled marker so the subject reads as visually
// distinct from the comps regardless of which chart is showing.
// Teal, reused straight from the Market Value module's own assigned icon
// color (ICON_COLORS[2] in icon-colors.ts) — comps read as "this module's
// color," not an invented chart palette.
export const COMPS_DOT_COLOR = "#0d9488";
// Sky blue, also an existing app tone (ICON_COLORS[6], already live on the
// Income Value module) reused here as a "this one is you" highlight —
// deliberately distinct from the comps' teal so the subject reads at a
// glance, without inventing a color the app doesn't already use elsewhere.
export const SUBJECT_DOT_COLOR = "#0284c7";

export function compDotShape(props: { cx?: number; cy?: number }) {
  return <circle cx={props.cx} cy={props.cy} r={7} fill={COMPS_DOT_COLOR} fillOpacity={0.7} />;
}

// Two-line "Subject / Property" label for the full 2-D plot, where there's
// room above the dot for it.
export function subjectDotShape(props: { cx?: number; cy?: number }) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill={SUBJECT_DOT_COLOR}
        stroke="var(--card)"
        strokeWidth={2.5}
      />
      <text
        x={cx}
        y={cy - 25}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={SUBJECT_DOT_COLOR}
      >
        Subject
      </text>
      <text
        x={cx}
        y={cy - 13}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={SUBJECT_DOT_COLOR}
      >
        Property
      </text>
    </g>
  );
}

// Compact single-line "Subject" label for the shorter 1-D fallback chart.
export function subjectDotShapeCompact(props: { cx?: number; cy?: number }) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={9}
        fill={SUBJECT_DOT_COLOR}
        stroke="var(--card)"
        strokeWidth={2.5}
      />
      <text
        x={cx}
        y={cy - 14}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={SUBJECT_DOT_COLOR}
      >
        Subject
      </text>
    </g>
  );
}

// Right-aligned "Subject / Property" label for Tier 3's distance chart,
// where the subject sits at x=0 — the chart's own left edge — so a
// centered label above the dot (like subjectDotShape) would clip against
// the axis border. Text runs rightward from the dot instead.
export function subjectDotShapeAtOrigin(props: { cx?: number; cy?: number }) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill={SUBJECT_DOT_COLOR}
        stroke="var(--card)"
        strokeWidth={2.5}
      />
      <text
        x={cx + 15}
        y={cy - 4}
        textAnchor="start"
        fontSize={11}
        fontWeight={700}
        fill={SUBJECT_DOT_COLOR}
      >
        Subject
      </text>
      <text
        x={cx + 15}
        y={cy + 10}
        textAnchor="start"
        fontSize={11}
        fontWeight={700}
        fill={SUBJECT_DOT_COLOR}
      >
        Property
      </text>
    </g>
  );
}

// Best real value available for a comp — tries marketValue first, then
// appraisedValue, then landValue+improvementValue summed, all real CAD
// fields on the same row. TrueProdigy is known-inconsistent about which of
// these it actually populates for a given county/property (some rows carry
// an appraised or land+improvement figure but a null marketValue) — this
// widens which comps the CARD's own chart can plot without changing
// computeComparableStats()'s stricter marketValue-only definition, which
// still drives the actual $ figures (Market Value Range, Valuation Gap,
// "Limited Comparable Data") since those feed the real protest argument.
export function bestAvailableValue(c: {
  marketValue: number | null;
  appraisedValue?: number | null;
  landValue?: number | null;
  improvementValue?: number | null;
}): number | null {
  if (c.marketValue != null) return c.marketValue;
  if (c.appraisedValue != null) return c.appraisedValue;
  if (c.landValue != null && c.improvementValue != null) return c.landValue + c.improvementValue;
  return null;
}

export function CompsValueScatter({
  subject,
  subjectValue,
  comps,
}: {
  subject: CompProperty | null;
  // The subject's real assessed value — passed in from
  // computeComparableStats()'s own subjectValue (totalValue ?? the raw
  // TrueProdigy subject record's marketValue), NOT read off `subject`
  // directly: the comps-endpoint's own subject row doesn't always carry a
  // marketValue, while the account's actual confirmed total value (already
  // shown elsewhere as "CAD Value") almost always does. Using the weaker
  // field here was why the chart went blank on some real properties even
  // though a real value existed.
  subjectValue: number | null;
  comps: RankedComp[];
}) {
  const subjectBestValue = subjectValue ?? (subject ? bestAvailableValue(subject) : null);
  const subjectPoint2D =
    subject?.legalAcreage && valuePerAcre(subjectBestValue, subject.legalAcreage) != null
      ? {
          x: subject.legalAcreage,
          y: valuePerAcre(subjectBestValue, subject.legalAcreage) as number,
        }
      : null;
  const points2D = comps
    .slice(0, 10)
    .map((c) => ({
      x: c.legalAcreage ?? null,
      y: valuePerAcre(bestAvailableValue(c), c.legalAcreage),
    }))
    .filter((p): p is { x: number; y: number } => p.x != null && p.y != null);

  // legalAcreage isn't populated for every CAD row the way value fields
  // are — a real 2-D plot needs both dimensions on the subject AND at
  // least one comp, or it's just an empty box. When there isn't enough of
  // it, fall back to a 1-D value-only scatter (present far more
  // consistently) rather than rendering nothing.
  if (subjectPoint2D && points2D.length > 0) {
    const allX = points2D.map((p) => p.x).concat([subjectPoint2D.x]);
    const allY = points2D.map((p) => p.y).concat([subjectPoint2D.y]);
    const xMin = Math.min(...allX);
    const xMax = Math.max(...allX);
    const yMin = Math.min(...allY);
    const yMax = Math.max(...allY);
    const xPad = (xMax - xMin) * 0.2 || xMax * 0.2 || 1;
    const yPad = (yMax - yMin) * 0.2 || yMax * 0.2 || 1;

    return (
      <div>
        <div className="flex items-stretch gap-1">
          <div className="flex flex-col justify-between py-2 text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>High</span>
            <span>Low</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="border-b border-l border-border">
              <ResponsiveContainer width="100%" height={190}>
                <ScatterChart margin={{ top: 36, right: 20, bottom: 8, left: 8 }}>
                  <XAxis type="number" dataKey="x" domain={[xMin - xPad, xMax + xPad]} hide />
                  <YAxis type="number" dataKey="y" domain={[yMin - yPad, yMax + yPad]} hide />
                  <ReferenceLine
                    y={subjectPoint2D.y}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <Scatter data={points2D} shape={compDotShape} />
                  <Scatter data={[subjectPoint2D]} shape={subjectDotShape} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Small</span>
              <span>Land Size</span>
              <span>Large</span>
            </div>
          </div>
        </div>
        <div className="mt-0.5 text-center text-[9px] text-muted-foreground">Value Per Acre</div>
      </div>
    );
  }

  // Fallback tier 2: 1-D, value-only scatter (no land-size axis) — still
  // real data (marketValue, or appraisedValue, or landValue+improvementValue
  // — see bestAvailableValue above), just less of it plotted.
  const valuePoints = comps
    .slice(0, 10)
    .map((c) => bestAvailableValue(c))
    .filter((v): v is number => v != null)
    .map((v) => ({ x: v, y: 0 }));
  // Requires BOTH the subject and at least one comp to have a real value —
  // a subject-only dot with nothing to compare it against isn't a
  // meaningful plot (same requirement Tier 1 already applies). When comps
  // have no usable value at all, fall through to Tier 3 instead, which
  // always has real multi-point data to show.
  if (valuePoints.length > 0 && subjectBestValue != null) {
    const allValues = valuePoints
      .map((p) => p.x)
      .concat(subjectBestValue != null ? [subjectBestValue] : []);
    const vMin = Math.min(...allValues);
    const vMax = Math.max(...allValues);
    const vPad = (vMax - vMin) * 0.2 || vMax * 0.1 || 1000;

    return (
      <div>
        <ResponsiveContainer width="100%" height={120}>
          <ScatterChart margin={{ top: 26, right: 16, bottom: 6, left: 16 }}>
            <XAxis type="number" dataKey="x" domain={[vMin - vPad, vMax + vPad]} hide />
            <YAxis type="number" dataKey="y" domain={[-1, 1]} hide />
            {valuePoints.length > 0 && <Scatter data={valuePoints} shape={compDotShape} />}
            {subjectBestValue != null && (
              <Scatter data={[{ x: subjectBestValue, y: 0 }]} shape={subjectDotShapeCompact} />
            )}
          </ScatterChart>
        </ResponsiveContainer>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{compactCurrency(vMin)}</span>
          <span>Assessed Value</span>
          <span>{compactCurrency(vMax)}</span>
        </div>
      </div>
    );
  }

  // Fallback tier 3: no usable value field at all on the subject or any
  // comp (rare, but real — some TrueProdigy rows carry no value data
  // whatsoever). distanceMi and similarity are always real, always present
  // on every RankedComp regardless of value data (plain haversine distance
  // + similarityScore(), see comps-analysis.ts) — this tier can't go blank
  // as long as at least one comp was found, so it's the guaranteed floor
  // for "always show something meaningful."
  if (comps.length === 0) return null;
  const distancePoints = comps.slice(0, 10).map((c) => ({ x: c.distanceMi, y: c.similarity }));
  const maxDistance = Math.max(...distancePoints.map((p) => p.x), 0.1);

  return (
    <div>
      <div className="flex items-stretch gap-1">
        <div className="flex flex-col justify-between py-2 text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>High</span>
          <span>Low</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="border-b border-l border-border">
            <ResponsiveContainer width="100%" height={190}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 8, left: 8 }}>
                <XAxis type="number" dataKey="x" domain={[0, maxDistance * 1.15]} hide />
                <YAxis type="number" dataKey="y" domain={[0, 100]} hide />
                <Scatter data={distancePoints} shape={compDotShape} />
                <Scatter data={[{ x: 0, y: 100 }]} shape={subjectDotShapeAtOrigin} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Near</span>
            <span>Distance</span>
            <span>Far</span>
          </div>
        </div>
      </div>
      <div className="mt-0.5 text-center text-[9px] text-muted-foreground">Similarity</div>
    </div>
  );
}

// Real-count selection funnel — "N Properties Reviewed → N Qualified → N
// Best Comps Selected," matching the spec's own recommended visual flow
// (comps.length → usable.length → min(5, usable.length), all straight from
// computeComparableStats in comps-analysis.ts — no AI estimate involved).
export function ComparableSelectionFunnel({
  reviewed,
  qualified,
  selected,
}: {
  reviewed: number;
  qualified: number;
  selected: number;
}) {
  const stages = [
    { label: "Properties Reviewed", value: reviewed },
    { label: "Qualified", value: qualified },
    { label: "Best Comps Selected", value: selected },
  ];
  return (
    <div className="flex items-center justify-between gap-1.5 rounded-lg bg-secondary/40 p-3 text-center">
      {stages.map((s, i) => (
        <Fragment key={s.label}>
          <div className="min-w-0">
            <div className="text-xl font-bold">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
          </div>
          {i < stages.length - 1 && (
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// Real per-signal deltas already computed inside similarityScore() — value
// % diff, distance, land-size % diff, property-type match — surfaced as
// "how each top comp differs from the subject" instead of staying buried
// inside one opaque similarity number. Deliberately NOT a dollar-per-SF
// adjustment: no building-size field exists anywhere in this pipeline (see
// comps-analysis.ts), so this only ever shows real percentage/distance
// deltas, never a fabricated adjustment value.
export function ComparableAdjustments({
  subject,
  subjectAddress,
  subjectValue,
  comps,
  numberOf,
}: {
  subject: CompProperty;
  subjectAddress?: string | null;
  subjectValue?: number | null;
  comps: RankedComp[];
  numberOf: Map<string, number>;
}) {
  if (comps.length === 0) return null;
  return (
    <div className="grid gap-2">
      <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
        <div className="truncate font-semibold">
          {subjectAddress || subject.address || "This property"}{" "}
          <span className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">
            Subject property
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>
            Value:{" "}
            {(subjectValue ?? subject.marketValue) != null
              ? compactCurrency((subjectValue ?? subject.marketValue) as number)
              : "—"}
          </span>
          <span>Land size: {formatAcres(subject.legalAcreage) ?? "not on file"}</span>
          <span>The comps below are compared against this property.</span>
        </div>
      </div>
      {comps.map((c) => {
        const valueDiffPct =
          subject.marketValue && c.marketValue
            ? Math.round(((c.marketValue - subject.marketValue) / subject.marketValue) * 100)
            : null;
        const landDiffPct =
          subject.legalAcreage && c.legalAcreage
            ? Math.round(((c.legalAcreage - subject.legalAcreage) / subject.legalAcreage) * 100)
            : null;
        const sameType = subject.propType && c.propType ? subject.propType === c.propType : null;
        return (
          <div key={c.key} className="rounded-lg border border-border p-3 text-sm">
            <div className="truncate font-semibold">{compLabel(c, numberOf)}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                Value:{" "}
                {valueDiffPct != null ? (
                  <span className={valueDiffPct >= 0 ? "text-success" : "text-destructive"}>
                    {valueDiffPct > 0 ? "+" : ""}
                    {valueDiffPct}%
                  </span>
                ) : (
                  "—"
                )}
              </span>
              <span>Distance: {c.distanceMi.toFixed(2)} mi</span>
              <span>
                Land size:{" "}
                {landDiffPct != null
                  ? `${landDiffPct > 0 ? "+" : ""}${landDiffPct}%`
                  : "not on file"}
              </span>
              <span>
                Property type: {sameType == null ? "not on file" : sameType ? "same" : "different"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Subject's CAD value vs. each top comp's assessed value — the real
// "does the subject look high?" comparison at a glance. Relabeled from the
// spec's own "$/SF" framing to plain assessed value, since no building-SF
// field exists anywhere in this pipeline (real $/acre is already surfaced
// per-row in ComparableTable, where land size is on file).
export function ComparableValueChart({
  subjectValue,
  comps,
  numberOf,
  median,
}: {
  subjectValue: number | null;
  comps: RankedComp[];
  numberOf: Map<string, number>;
  median: number | null;
}) {
  // Truncated to a fixed short length (not left to Recharts' own tick
  // wrapping) — a full street address at this axis width wrapped into 2-3
  // ugly lines per bar; a short, consistent label reads far better than a
  // literal-but-cramped one here, and the full address is already the row
  // label in ComparableTable right above this chart.
  const shortLabel = (s: string) => (s.length > 13 ? `${s.slice(0, 12)}…` : s);
  const data = [
    ...(subjectValue != null
      ? [{ name: "Subject property", value: subjectValue, isSubject: true }]
      : []),
    ...comps
      .filter((c): c is RankedComp & { marketValue: number } => c.marketValue != null)
      .map((c) => ({
        name: `${numberOf.has(c.key) ? `${numberOf.get(c.key)}. ` : ""}${shortLabel(
          c.address ? c.address.split(",")[0] : `Property #${c.pid}`,
        )}`,
        value: c.marketValue,
        isSubject: false,
      })),
  ];
  if (data.length === 0) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <XAxis type="number" tickFormatter={compactCurrency} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} interval={0} />
          {median != null && (
            <ReferenceLine
              x={median}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
              label={{
                value: "Median",
                position: "top",
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
            />
          )}
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.isSubject ? "var(--destructive)" : "var(--success)"} />
            ))}
            <LabelList dataKey="value" position="right" formatter={compactCurrency} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// The equal-and-uniform rate range behind the indicated value: every comp
// priced BELOW the subject's own $/acre, restated at the subject's actual
// size — what the subject would be worth at that comp's rate (see
// computeComparableStats's own "Rate-based indicated range" comment).
// Product-specified 2026-09: no size or time adjustment, and only comps that
// argue for a lower value are shown here at all. All deterministic, never
// AI-written.
export function CompsAdjustmentGrid({
  perCompAdjustment,
  selected,
  numberOf,
  adjustedIndicated,
  subjectAddress,
  subjectValue,
  subjectAcres,
}: {
  perCompAdjustment: ComparableStats["perCompAdjustment"];
  selected: RankedComp[];
  numberOf: Map<string, number>;
  adjustedIndicated: ComparableStats["adjustedIndicated"];
  subjectAddress?: string | null;
  subjectValue: number | null;
  subjectAcres: number | null;
}) {
  if (!adjustedIndicated || perCompAdjustment.length === 0) return null;
  const subjectPerAcre = valuePerAcre(subjectValue, subjectAcres);
  const adjByKey = new Map(perCompAdjustment.map((a) => [a.key, a]));
  return (
    <div>
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Top {selected.length} Comps vs. Subject Rate → Indicated Target Range
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Property</th>
              <th className="px-3 py-2 font-semibold">Unit ($/acre)</th>
              <th className="px-3 py-2 font-semibold">Value / Acre</th>
              <th className="px-3 py-2 font-semibold">Subject Value at This Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-accent/5">
              <td className="px-3 py-2 font-medium">
                {subjectAddress ? subjectAddress.split(",")[0] : "This property"}{" "}
                <span className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">
                  Subject property
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">$/acre</td>
              <td className="px-3 py-2 text-muted-foreground">
                {subjectPerAcre != null ? compactCurrency(subjectPerAcre) : "—"}
              </td>
              <td className="px-3 py-2 font-semibold">
                {subjectValue != null ? compactCurrency(subjectValue) : "—"}{" "}
                <span className="font-normal text-muted-foreground">(CAD value)</span>
              </td>
            </tr>
            {selected.map((c) => {
              const a = adjByKey.get(c.key);
              const perAcre = valuePerAcre(c.marketValue, c.legalAcreage);
              return (
                <tr
                  key={c.key}
                  className={`border-t border-border/60 ${a ? "" : "text-muted-foreground"}`}
                >
                  <td className="px-3 py-2">{compLabel(c, numberOf)}</td>
                  <td className="px-3 py-2 text-muted-foreground">$/acre</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a
                      ? compactCurrency(a.compPerAcre)
                      : perAcre != null
                        ? compactCurrency(perAcre)
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {a ? (
                      <span className="font-semibold">
                        {compactCurrency(a.subjectValueAtCompRate)}
                      </span>
                    ) : (
                      <span className="text-xs">
                        {perAcre == null
                          ? "No land size on file — not used"
                          : "At or above the subject's rate — not used"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Indicated target:{" "}
        <span className="font-semibold text-foreground">
          {compactCurrency(adjustedIndicated.value)}
        </span>{" "}
        ({compactCurrency(adjustedIndicated.min)}–{compactCurrency(adjustedIndicated.max)}). Each
        comp&apos;s own $/acre applied to the subject&apos;s actual size — only comps priced below
        the subject&apos;s own $/acre count; a comp priced at or above it doesn&apos;t argue for a
        lower value.
      </p>
    </div>
  );
}

// Real, deterministic explanation of the confidence score — the same two
// inputs computeComparableStats() itself blends (usable comp count, value
// spread), phrased in a sentence — never AI-written, matching the
// SupportingDataGrid/SourcesList convention already used for Module 1.
export function comparableConfidenceReasoning(stats: ComparableStats): string | null {
  if (stats.confidencePct == null || stats.indicated == null) return null;
  const count = stats.selected.length;
  const spreadPct =
    stats.indicated.median > 0
      ? Math.round(((stats.indicated.max - stats.indicated.min) / stats.indicated.median) * 100)
      : null;
  const countPhrase = `The ${count} selected comparable ${count === 1 ? "property" : "properties"}`;
  const spreadPhrase =
    spreadPct != null
      ? spreadPct <= 20
        ? "a tight value range"
        : spreadPct <= 50
          ? "a moderate value range"
          : "a wide value range"
      : null;
  return spreadPhrase
    ? `${countPhrase}, within ${spreadPhrase} (±${spreadPct}%), support this indicated value.`
    : `${countPhrase} support this indicated value.`;
}

// A real deed date (see CompProperty.lastTransferDt), never a sale price —
// formatted plainly so it can't be mistaken for one.
export function formatTransferDate(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatAcres(v?: number | null): string | null {
  if (v == null) return null;
  return `${v.toFixed(v < 1 ? 2 : 1)} ac`;
}

// $-per-acre, the real per-unit metric this data actually supports — not a
// $/SF substitute, since no building-size field exists (see comps-analysis.ts).
export function valuePerAcre(marketValue?: number | null, acreage?: number | null): number | null {
  if (marketValue == null || !acreage || acreage < 0.05) return null;
  return marketValue / acreage;
}

// Real per-comp comparison table — Property / Last Transfer / Land Size /
// Assessed Value / $ per Acre / Distance / Similarity, all real fields (see
// comps-analysis.ts). Each row expands on click (not hover, so it works on
// touch too). When `onToggleExclude` is passed (the live modal, not the
// printable report) each row gets a Keep checkbox and the AI's per-comp
// verdict; excluded comps render struck through and are already out of the
// value math (computeComparableStats drops them).
export type PerCompVerdict = {
  key: string;
  verdict: "use" | "exclude";
  reason: string;
  flags?: string[];
};

// Deterministic flags read as "less reliable"; the informational ones
// ("Not a market sale" is true of every CAD comp) get a quieter style.
export const COMP_FLAG_TONE: Record<string, string> = {
  Stale: "bg-warning/20 text-warning-foreground",
  Distant: "bg-warning/20 text-warning-foreground",
  "Size mismatch": "bg-warning/20 text-warning-foreground",
  "Type mismatch": "bg-warning/20 text-warning-foreground",
  "Unverified price": "bg-destructive/15 text-destructive",
};
// "Comp 3 — 1001 Hwy66, TX": the same number everywhere a final comp shows.
export function compLabel(c: RankedComp, numberOf?: Map<string, number>): string {
  const n = numberOf?.get(c.key);
  const addr = c.address || `Property #${c.pid}`;
  return n != null ? `Comp ${n} — ${addr}` : addr;
}

export function ComparableTable({
  ranked,
  cad,
  perComp,
  recommendedKeys,
  onToggleSelect,
  onRemove,
  onReset,
  canReset,
  numberOf,
  subjectAddress,
  subjectValue,
  subjectAcres,
}: {
  ranked: RankedComp[];
  cad?: string;
  perComp?: Map<string, PerCompVerdict>;
  recommendedKeys?: Set<string>;
  onToggleSelect?: (comp: RankedComp, select: boolean) => void;
  onRemove?: (comp: RankedComp) => void;
  onReset?: () => void;
  canReset?: boolean;
  // Final comp → its 1-5 number (see compLabel).
  numberOf: Map<string, number>;
  subjectAddress?: string | null;
  // The subject's own assessed value / land size — same valuePerAcre() basis
  // every comp row already uses, so "$ / Acre" and "vs Subject" below are a
  // fair apples-to-apples read, not assessed value skewed by lot size.
  subjectValue?: number | null;
  subjectAcres?: number | null;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (ranked.length === 0) return null;
  const interactive = !!onToggleSelect;
  const showAi = !!perComp && perComp.size > 0;
  const subjectPerAcre = valuePerAcre(subjectValue, subjectAcres);
  const showVsSubject = subjectPerAcre != null;
  const colCount = 7 + (interactive ? 1 : 0) + (showAi ? 1 : 0) + (showVsSubject ? 1 : 0);
  // Subject-address parcels, then the final 5 in number order, then the rest
  // (only once "show all" is on).
  const subjectRows = ranked.filter((c) => c.isSubject);
  const chosen = ranked
    .filter((c) => c.selected)
    .sort((a, b) => (numberOf.get(a.key) ?? 0) - (numberOf.get(b.key) ?? 0));
  const others = ranked.filter((c) => !c.isSubject && !c.selected);
  const rows = [...subjectRows, ...chosen, ...(showAll ? others : [])];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {interactive
            ? `Corvus AI picked the ${chosen.length} most similar comps. Review the full list and tick the ${TOP_N_FOR_INDICATED_VALUE} you want to use — everything below updates to match.`
            : `The ${chosen.length} comps used for everything below.`}
        </p>
        {interactive && canReset && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-border px-3 py-1 text-sm font-medium hover:bg-secondary"
          >
            Reset to AI picks
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-secondary/30 px-3 py-2 text-sm">
          <span className="font-semibold text-foreground">Comparable Properties</span>
          <span className="text-muted-foreground">
            Subject property{subjectAddress ? ` (${subjectAddress.split(",")[0]})` : ""}:{" "}
            {subjectAcres != null && `${formatAcres(subjectAcres)} · `}
            {subjectValue != null && compactCurrency(subjectValue)}
            {subjectPerAcre != null && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">
                  {compactCurrency(subjectPerAcre)}
                </span>
                /acre
              </>
            )}
          </span>
        </div>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {interactive && <th className="px-3 py-2 font-semibold">Use</th>}
              <th className="px-3 py-2 font-semibold">Property</th>
              {showAi && <th className="px-3 py-2 font-semibold">AI</th>}
              <th className="px-3 py-2 font-semibold">Last Transfer</th>
              <th className="px-3 py-2 font-semibold">Land Size</th>
              <th className="px-3 py-2 font-semibold">Assessed Value</th>
              <th className="px-3 py-2 font-semibold">$ / Acre</th>
              {showVsSubject && <th className="px-3 py-2 font-semibold">vs Subject</th>}
              <th className="px-3 py-2 font-semibold">Distance</th>
              <th className="px-3 py-2 font-semibold">Similarity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const expanded = expandedKey === c.key;
              const perAcre = valuePerAcre(c.marketValue, c.legalAcreage);
              const pc = perComp?.get(c.key);
              const recommended = recommendedKeys?.has(c.key);
              const n = numberOf.get(c.key);
              return (
                <Fragment key={c.key}>
                  <tr
                    onClick={() => setExpandedKey(expanded ? null : c.key)}
                    className={`cursor-pointer border-t border-border/60 hover:bg-secondary/40 ${
                      c.isSubject ? "bg-accent/5" : c.selected ? "" : "text-muted-foreground"
                    }`}
                  >
                    {interactive && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {!c.isSubject && (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!c.selected}
                            disabled={c.marketValue == null}
                            onChange={(e) => onToggleSelect!(c, e.target.checked)}
                            aria-label={c.selected ? "Stop using this comp" : "Use this comp"}
                            title={c.marketValue == null ? "No assessed value on file" : undefined}
                          />
                        )}
                      </td>
                    )}
                    <td className="max-w-[16rem] px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {n != null && (
                          <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                            {n}
                          </span>
                        )}
                        <span className="truncate">{c.address || `Property #${c.pid}`}</span>
                      </span>
                      {(() => {
                        const all = c.isSubject
                          ? []
                          : [...new Set([...(c.flags ?? []), ...(pc?.flags ?? [])])];
                        if (all.length === 0 && !c.isSubject && !c.userAdded) return null;
                        return (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {c.isSubject && (
                              <span className="whitespace-nowrap rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                                Subject property — not used as a comp
                              </span>
                            )}
                            {c.userAdded && (
                              <span className="whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                Added by you
                              </span>
                            )}
                            {all.map((f) => (
                              <span
                                key={f}
                                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold no-underline ${
                                  COMP_FLAG_TONE[f] ?? "bg-secondary text-muted-foreground"
                                }`}
                              >
                                {f}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    </td>
                    {showAi && (
                      <td className="px-3 py-2">
                        {recommended ? (
                          <span className="whitespace-nowrap rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success no-underline">
                            Recommended
                          </span>
                        ) : pc?.verdict === "exclude" ? (
                          <span className="whitespace-nowrap rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning-foreground no-underline">
                            Exclude
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.userAdded && c.saleDate
                        ? c.saleDate
                        : (formatTransferDate(c.lastTransferDt) ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatAcres(c.legalAcreage) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {c.userAdded
                        ? c.salePrice != null
                          ? compactCurrency(c.salePrice)
                          : "Not verified"
                        : c.marketValue != null
                          ? compactCurrency(c.marketValue)
                          : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {perAcre != null ? compactCurrency(perAcre) : "—"}
                    </td>
                    {showVsSubject && (
                      <td className="px-3 py-2 text-muted-foreground">
                        {perAcre != null && subjectPerAcre != null
                          ? (() => {
                              const deltaPct = Math.round(
                                ((perAcre - subjectPerAcre) / subjectPerAcre) * 100,
                              );
                              return `${deltaPct > 0 ? "+" : ""}${deltaPct}%`;
                            })()
                          : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.distanceMi.toFixed(2)} mi
                    </td>
                    <td
                      className="px-3 py-2 font-semibold"
                      style={{ color: scoreColor(c.similarity) }}
                    >
                      {c.similarity}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-border/60 bg-secondary/30">
                      <td colSpan={colCount} className="px-3 py-3">
                        <div className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
                          {pc?.reason && (
                            <div className="sm:col-span-2">
                              <span className="font-semibold text-foreground">AI: </span>
                              {pc.verdict === "exclude"
                                ? "Suggest excluding — "
                                : "Suggest using — "}
                              {pc.reason}
                            </div>
                          )}
                          {c.userAdded ? (
                            <>
                              <div>
                                Sale price:{" "}
                                {c.salePrice != null
                                  ? currency(c.salePrice)
                                  : "Sale Price Not Verified"}
                              </div>
                              <div>Sale date: {c.saleDate ?? "—"}</div>
                              <div>
                                Building SF:{" "}
                                {c.buildingSqft != null ? c.buildingSqft.toLocaleString() : "—"}
                              </div>
                              <div>
                                $/SF: {c.pricePerSqft != null ? currency(c.pricePerSqft) : "—"}
                              </div>
                              <div>
                                Verified: {c.saleVerified ? "Yes — from uploaded document" : "No"}
                              </div>
                              {onRemove && (
                                <div className="sm:col-span-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRemove(c);
                                    }}
                                    className="text-destructive underline underline-offset-2"
                                  >
                                    Remove this comp
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div>Owner: {c.ownerName ?? "Not on file"}</div>
                              <div>
                                Land value: {c.landValue != null ? currency(c.landValue) : "—"}
                              </div>
                              <div>
                                Improvement value:{" "}
                                {c.improvementValue != null ? currency(c.improvementValue) : "—"}
                              </div>
                              <div>
                                Appraised value:{" "}
                                {c.appraisedValue != null ? currency(c.appraisedValue) : "—"}
                              </div>
                              <div>Sale price: Sale Price Not Verified (assessed-value comp)</div>
                              {c.zoning && <div>Zoning: {c.zoning}</div>}
                              <div>
                                Source:{" "}
                                {(() => {
                                  const url = cad
                                    ? getCadRecordUrl({ cad, accountNumber: String(c.pid) })
                                    : null;
                                  if (!url)
                                    return c.pid ? `CAD record #${c.pid}` : "CAD public record";
                                  return (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-accent underline underline-offset-2"
                                    >
                                      {isDirectCadRecordUrl(cad!)
                                        ? `View CAD record #${c.pid}`
                                        : `Search ${cad} for #${c.pid}`}
                                    </a>
                                  );
                                })()}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {others.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-sm font-medium text-accent underline underline-offset-2"
        >
          {showAll
            ? "Show only the comps in use"
            : `Review the full comp list (${others.length} more)`}
        </button>
      )}
    </div>
  );
}

// "Add a comparable" — a comp the user knows about that the CAD feed didn't
// surface (or a real sale from a document). Address is geocoded on submit so
// it lands on the map relative to the subject; sale figures are optional and
// stay unverified until backed by an uploaded document (Phase C).
export function AddCompForm({
  onAdd,
  onExtractSale,
}: {
  onAdd: (input: CompSelectionInput) => void;
  onExtractSale: (file: File) => Promise<CompSaleExtraction | null>;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [buildingSqft, setBuildingSqft] = useState("");
  const [landSqft, setLandSqft] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a sale document has been read — the comp then saves as verified
  // and links back to that document.
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  const num = (s: string) => {
    const n = Number(s.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function reset() {
    setAddress("");
    setSalePrice("");
    setSaleDate("");
    setBuildingSqft("");
    setLandSqft("");
    setSource("");
    setNotes("");
    setSourceDocumentId(null);
    setExtractNote(null);
    setError(null);
  }

  async function handleDoc(file: File) {
    setExtracting(true);
    setError(null);
    setExtractNote(null);
    try {
      const r = await onExtractSale(file);
      if (!r) {
        setError("Couldn't read that document. Enter the details by hand instead.");
        return;
      }
      if (r.address) setAddress((prev) => prev || r.address!);
      if (r.salePrice != null) setSalePrice(String(r.salePrice));
      if (r.saleDate) setSaleDate(r.saleDate);
      if (r.buildingSqft != null) setBuildingSqft(String(r.buildingSqft));
      if (r.landSqft != null) setLandSqft(String(r.landSqft));
      if (r.source) setSource((prev) => prev || r.source!);
      if (r.salePrice != null) {
        setSourceDocumentId(r.documentId);
        setExtractNote(
          `Read from your document${r.notes ? ` — ${r.notes}` : ""}. Review, then add.`,
        );
      } else {
        setSourceDocumentId(null);
        setExtractNote(
          `No sale price found in that document${r.notes ? ` — ${r.notes}` : ""}. Enter it by hand.`,
        );
      }
    } catch {
      setError("Couldn't read that document. Enter the details by hand instead.");
    } finally {
      setExtracting(false);
    }
  }

  async function submit() {
    if (!address.trim()) {
      setError("Enter the comparable's address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const point = await geocodeAddress(address.trim());
      if (!point) {
        setError("Couldn't locate that address. Check the spelling or add city + ZIP.");
        return;
      }
      onAdd({
        compKey: `user:${crypto.randomUUID()}`,
        action: "include",
        address: address.trim(),
        latitude: point.lat,
        longitude: point.lng,
        salePrice: num(salePrice),
        saleDate: saleDate || null,
        buildingSqft: num(buildingSqft),
        landSqft: num(landSqft),
        source: source.trim() || null,
        notes: notes.trim() || null,
        saleVerified: !!sourceDocumentId && num(salePrice) != null,
        sourceDocumentId,
      });
      setOpen(false);
      reset();
    } catch {
      setError("Couldn't add that comp. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10"
      >
        <Upload className="h-3.5 w-3.5" /> Add a comparable
      </button>
    );
  }

  const field = "rounded-md border border-input bg-background px-2.5 py-1.5 text-xs";
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="text-xs font-semibold">Add a comparable</div>
      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10">
        <input
          type="file"
          accept="image/*,.pdf"
          disabled={extracting}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleDoc(f);
            e.target.value = "";
          }}
        />
        <Upload className="h-3.5 w-3.5" />
        {extracting ? "Reading document…" : "Upload a sale document (AI reads it)"}
      </label>
      {extractNote && <p className="text-[11px] text-accent">{extractNote}</p>}
      <input
        className={field}
        placeholder="Address (required) — street, city, ZIP"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={field}
          placeholder="Sale price (optional)"
          value={salePrice}
          onChange={(e) => setSalePrice(e.target.value)}
        />
        <input
          className={field}
          type="date"
          placeholder="Sale date"
          value={saleDate}
          onChange={(e) => setSaleDate(e.target.value)}
        />
        <input
          className={field}
          placeholder="Building SF (optional)"
          value={buildingSqft}
          onChange={(e) => setBuildingSqft(e.target.value)}
        />
        <input
          className={field}
          placeholder="Land SF (optional)"
          value={landSqft}
          onChange={(e) => setLandSqft(e.target.value)}
        />
      </div>
      <input
        className={field}
        placeholder="Source (broker, appraisal, listing…) — optional"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <input
        className={field}
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <p className="text-[11px] text-muted-foreground">
        Sale price stays marked “Not Verified” until backed by an uploaded closing statement or
        appraisal.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="btn-primary btn-primary-hover text-xs disabled:opacity-60"
        >
          {busy ? "Locating…" : "Add comp"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-outline text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}
