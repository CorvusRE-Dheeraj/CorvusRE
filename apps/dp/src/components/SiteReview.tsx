import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import type { DesignRequestRow } from "@/lib/design-requests";
import { parseArea, parseFloors, siteFit, siteStrips } from "@/lib/site-fit";
import {
  SIDES,
  SIDE_LABEL,
  ft,
  saveSiteInputs,
  sqft,
  type Side,
  type SiteInputs,
  type SurveyReading,
} from "@/lib/survey-reading";
import { DEFAULT_SF_PER_STALL, confirmKey, isConfirmed, stallsNeeded } from "@/lib/schematic";

/** JSON with object keys sorted and empty values dropped, so equal values compare equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

// Step 6 of the survey workflow: before a schematic is generated the user
// checks what was read, corrects the buildable-area assumptions (which
// easements count, extra no-build strips, the program, parking, coverage) and
// confirms. Any later change needs confirming again.
export function SiteReviewPanel({
  dr,
  refetch,
}: {
  dr: DesignRequestRow;
  refetch: () => Promise<unknown>;
}) {
  const reading = (dr.survey_reading ?? null) as SurveyReading | null;
  const inputs: SiteInputs = dr.site_inputs ?? {};
  const program = { buildingArea: dr.building_area, floors: dr.floors };
  const [draft, setDraft] = useState({
    buildingArea: inputs.buildingAreaSqFt ? String(inputs.buildingAreaSqFt) : "",
    floors: inputs.floors ? String(inputs.floors) : "",
    parking: inputs.parkingSfPerStall ? String(inputs.parkingSfPerStall) : "",
    noParking: inputs.parkingSfPerStall === 0,
    coverage: inputs.maxCoveragePct ? String(inputs.maxCoveragePct) : "",
  });
  const [excluded, setExcluded] = useState<string[]>(inputs.excludedStrips ?? []);
  const [extra, setExtra] = useState(inputs.extraStrips ?? []);
  const [adding, setAdding] = useState<{ side: Side; ft: string; label: string }>({
    side: "rear",
    ft: "",
    label: "",
  });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!dr.survey_path) return null;

  const num = (s: string) => {
    const n = Number(s.replace(/[^\d.]/g, ""));
    return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const next: SiteInputs = {
    ...inputs,
    buildingAreaSqFt: num(draft.buildingArea),
    floors: num(draft.floors) ? Math.round(num(draft.floors)!) : null,
    parkingSfPerStall: draft.noParking ? 0 : num(draft.parking),
    maxCoveragePct: num(draft.coverage) && num(draft.coverage)! <= 100 ? num(draft.coverage) : null,
    excludedStrips: excluded,
    extraStrips: extra,
  };
  const fit = siteFit(reading, next, program);
  const confirmed = isConfirmed(fit, inputs, dr.survey_read_at);
  const wasConfirmed = !!inputs.confirmedAt;
  // compare values, not key order (the database returns JSON keys in its own order)
  const dirty =
    stable({ ...next, confirmedAt: null, confirmedKey: null }) !==
    stable({ ...inputs, confirmedAt: null, confirmedKey: null });
  const strips = siteStrips(reading, next);
  const stalls = stallsNeeded(dr.sector, fit.program.buildingAreaSqFt, next.parkingSfPerStall);
  const canConfirm = !!fit.lot && !!fit.envelope;

  async function save(confirm: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const toSave: SiteInputs = confirm
        ? {
            ...next,
            confirmedAt: new Date().toISOString(),
            confirmedKey: confirmKey(fit, next, dr.survey_read_at),
          }
        : next;
      await saveSiteInputs(dr.id, toSave);
      await refetch();
      setMsg(confirm ? null : "Assumptions saved.");
      setChecked(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
  const label = "grid min-w-0 gap-1 text-xs font-medium text-muted-foreground";
  return (
    <section className="card-elev p-5 sm:p-6" aria-labelledby="site-review-h">
      <h2 id="site-review-h" className="font-serif text-lg font-semibold">
        Review &amp; confirm before the schematic
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Surveys aren&apos;t always perfectly readable — check the reading, correct anything
        that&apos;s off, then confirm. The schematic plan is generated from what you confirm here.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="text-sm font-semibold">Easements &amp; no-build strips</div>
          <p className="text-xs text-muted-foreground">
            Untick one the survey shows but that doesn&apos;t apply; add any it missed.
          </p>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {strips.length === 0 && <li className="text-muted-foreground">None on the survey.</li>}
            {strips.map((x) => (
              <li
                key={x.key}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
              >
                {x.source === "survey" ? (
                  <input
                    type="checkbox"
                    checked={x.included}
                    onChange={(e) =>
                      setExcluded((cur) =>
                        e.target.checked ? cur.filter((k) => k !== x.key) : [...cur, x.key],
                      )
                    }
                    aria-label={`Count ${x.label}`}
                  />
                ) : (
                  <span className="w-[13px]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={x.included ? "" : "text-muted-foreground line-through"}>
                    {x.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ·{" "}
                    {x.side === "interior" || x.side === "unknown"
                      ? x.side
                      : SIDE_LABEL[x.side as Side].toLowerCase()}{" "}
                    · {ft(x.ft)} {x.source === "you" ? "· added by you" : "· from survey"}
                  </span>
                </span>
                {x.source === "you" && (
                  <button
                    type="button"
                    onClick={() => setExtra((cur) => cur.filter((_, i) => `x${i}` !== x.key))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${x.label}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5rem] gap-2 sm:grid-cols-[8rem_5rem_minmax(0,1fr)_auto]">
            <select
              value={adding.side}
              onChange={(e) => setAdding((a) => ({ ...a, side: e.target.value as Side }))}
              className={input}
              aria-label="Side of the new strip"
            >
              {SIDES.map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
            <input
              inputMode="decimal"
              value={adding.ft}
              onChange={(e) => setAdding((a) => ({ ...a, ft: e.target.value }))}
              placeholder="ft"
              className={input}
              aria-label="Width of the new strip in feet"
            />
            <input
              value={adding.label}
              onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))}
              placeholder="e.g. 15' landscape buffer"
              className={`${input} col-span-2 sm:col-span-1`}
              aria-label="What the new strip is"
            />
            <button
              type="button"
              disabled={!num(adding.ft)}
              onClick={() => {
                setExtra((cur) => [
                  ...cur,
                  {
                    side: adding.side,
                    ft: num(adding.ft)!,
                    label: adding.label.trim() || "No-build strip",
                  },
                ]);
                setAdding((a) => ({ ...a, ft: "", label: "" }));
              }}
              className="btn-outline col-span-2 inline-flex items-center justify-center gap-1 text-sm sm:col-span-1"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold">Building &amp; buildable-area assumptions</div>
          <p className="text-xs text-muted-foreground">
            Blank = use the design brief / typical value shown.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className={label}>
              Building area (sf)
              <input
                inputMode="numeric"
                value={draft.buildingArea}
                onChange={(e) => setDraft((d) => ({ ...d, buildingArea: e.target.value }))}
                placeholder={parseArea(dr.building_area)?.toLocaleString() ?? "e.g. 4,000"}
                className={input}
              />
            </label>
            <label className={label}>
              Floors
              <input
                inputMode="numeric"
                value={draft.floors}
                onChange={(e) => setDraft((d) => ({ ...d, floors: e.target.value }))}
                placeholder={String(parseFloors(dr.floors))}
                className={input}
              />
            </label>
            <label className={label}>
              Parking: 1 space per … sf
              <input
                inputMode="numeric"
                value={draft.noParking ? "" : draft.parking}
                disabled={draft.noParking}
                onChange={(e) => setDraft((d) => ({ ...d, parking: e.target.value }))}
                placeholder={String(DEFAULT_SF_PER_STALL)}
                className={input}
              />
            </label>
            <label className={label}>
              Max lot coverage (%)
              <input
                inputMode="numeric"
                value={draft.coverage}
                onChange={(e) => setDraft((d) => ({ ...d, coverage: e.target.value }))}
                placeholder="optional"
                className={input}
              />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.noParking}
                onChange={(e) => setDraft((d) => ({ ...d, noParking: e.target.checked }))}
              />
              No parking needed on this site
            </label>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4 text-sm">
        <div className="font-semibold">What the schematic will use</div>
        {fit.lot && fit.limits ? (
          <ul className="mt-1 grid gap-0.5 text-muted-foreground sm:grid-cols-2">
            <li>
              Lot {ft(fit.lot.widthFt)} × {ft(fit.lot.depthFt)} ({sqft(fit.lot.areaSqFt)})
            </li>
            <li>
              Kept clear: front {ft(fit.limits.front.ft)}, rear {ft(fit.limits.rear.ft)}, left{" "}
              {ft(fit.limits.left.ft)}, right {ft(fit.limits.right.ft)}
            </li>
            <li>
              Buildable area{" "}
              {fit.envelope
                ? `${ft(fit.envelope.widthFt)} × ${ft(fit.envelope.depthFt)} (${sqft(fit.envelope.areaSqFt)})`
                : "none"}
              {fit.maxFootprintSqFt ? ` · coverage cap ${sqft(fit.maxFootprintSqFt)}` : ""}
            </li>
            <li>
              Building{" "}
              {fit.program.buildingAreaSqFt ? sqft(fit.program.buildingAreaSqFt) : "area not set"}{" "}
              on {fit.program.floors} floor
              {fit.program.floors === 1 ? "" : "s"} ·{" "}
              {stalls ? `about ${stalls} parking spaces` : "no parking lot"}
            </li>
          </ul>
        ) : (
          <p className="mt-1 text-amber-700 dark:text-amber-400">
            Enter the missing site details above first.
          </p>
        )}
        {confirmed && !dirty ? (
          <p
            className="mt-3 flex flex-wrap items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmed{" "}
            {new Date(inputs.confirmedAt!).toLocaleString()}.
            <Link to="/dashboard/design-schematic" className="btn-accent text-sm">
              Go to the schematic plan
            </Link>
          </p>
        ) : (
          <>
            {wasConfirmed && (
              <p className="mt-3 font-medium text-amber-700 dark:text-amber-400" role="status">
                Something changed since you confirmed — check it and confirm again.
              </p>
            )}
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-1"
              />
              <span>
                I&apos;ve checked what Corvus AI read against my survey, and the setbacks and
                assumptions above are right.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!checked || !canConfirm || busy}
                onClick={() => void save(true)}
                className="btn-accent text-sm"
              >
                {busy ? "Saving…" : "Confirm site & assumptions"}
              </button>
              {dirty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(false)}
                  className="btn-outline text-sm"
                >
                  Save without confirming
                </button>
              )}
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
