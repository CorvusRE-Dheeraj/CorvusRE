import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import type { DesignRequestRow } from "@/lib/design-requests";
import {
  SIDES,
  SIDE_LABEL,
  areaMismatch,
  ft,
  missingSiteValues,
  readSurvey,
  readingIsUnclear,
  saveSiteInputs,
  siteValues,
  sqft,
  type SiteInputs,
  type Sourced,
  type SurveyReading as Reading,
} from "@/lib/survey-reading";
import { Pill } from "@/components/dp-ui";

export const UNCLEAR_MESSAGE =
  "Some site details could not be confidently read. Please confirm or enter setbacks manually.";

const CONF_TONE = { high: "green", medium: "amber", low: "red" } as const;

// Step 2 of the survey workflow: Corvus AI reads the uploaded survey (once,
// automatically, then on request), shows everything it found, flags what it
// couldn't read, and lets the user confirm or enter the lot size and setbacks.
export function SurveyReadingPanel({
  dr,
  refetch,
}: {
  dr: DesignRequestRow;
  refetch: () => Promise<unknown>;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  const r = (dr.survey_reading ?? null) as Reading | null;

  async function run() {
    setError(null);
    setReading(true);
    try {
      await readSurvey(dr.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Corvus AI couldn't read the survey.");
    } finally {
      await refetch();
      setReading(false);
    }
  }

  // read a newly uploaded survey straight away (once per file)
  useEffect(() => {
    if (!dr.survey_path || dr.survey_reading || dr.survey_read_error) return;
    if (started.current === dr.survey_path) return;
    started.current = dr.survey_path;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dr.survey_path, dr.survey_reading, dr.survey_read_error]);

  if (!dr.survey_path) return null;
  const failed = error ?? (!r ? dr.survey_read_error : null);

  return (
    <section className="card-elev p-5 sm:p-6" aria-labelledby="survey-reading-h">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="survey-reading-h"
            className="flex items-center gap-2 font-serif text-lg font-semibold"
          >
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> What Corvus AI read from the
            survey
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {dr.survey_read_at
              ? `Read ${new Date(dr.survey_read_at).toLocaleString()} · check it against the survey before you rely on it.`
              : "Boundary, dimensions, frontage, easements, setback lines and notes."}
          </p>
        </div>
        <button
          type="button"
          disabled={reading}
          onClick={() => void run()}
          className="btn-outline inline-flex items-center gap-1.5 text-sm"
        >
          {reading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {reading ? "Reading…" : r ? "Read again" : "Read survey with AI"}
        </button>
      </div>

      {reading && !r && (
        <p className="flex items-center gap-2 rounded-lg bg-secondary/50 p-4 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Corvus AI is reading your survey
          — this can take up to a minute for a PDF.
        </p>
      )}
      {failed && !reading && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm"
        >
          {failed} You can try again, or enter the lot size and setbacks below yourself.
        </div>
      )}

      {r && <ReadingDetails r={r} dr={dr} />}
      {(r || failed) && !reading && <ConfirmValues dr={dr} r={r} refetch={refetch} />}
    </section>
  );
}

function ReadingDetails({ r, dr }: { r: Reading; dr: DesignRequestRow }) {
  const v = siteValues(r, dr.site_inputs ?? null);
  const mismatch = areaMismatch(r);
  const card = (title: string, body: React.ReactNode, conf?: keyof typeof CONF_TONE) => (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        {conf && <Pill tone={CONF_TONE[conf]}>{conf} confidence</Pill>}
      </div>
      <div className="mt-1.5 grid gap-1 text-muted-foreground">{body}</div>
    </div>
  );
  return (
    <div className="grid gap-3">
      {readingIsUnclear(r, v) && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <div className="font-medium">{UNCLEAR_MESSAGE}</div>
            {!r.isSurvey && (
              <div className="mt-1">This file doesn&apos;t look like a land survey.</div>
            )}
            {(r.flags.length > 0 || mismatch) && (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {r.flags.map((f, i) => (
                  <li key={i}>
                    <b className="text-foreground">{f.field}:</b> {f.issue}
                  </li>
                ))}
                {mismatch && <li>{mismatch}</li>}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {card(
          "Property boundary",
          <>
            <span className="capitalize text-foreground">
              {r.boundary.shape === "unknown" ? "Shape not clear" : `${r.boundary.shape} lot`}
            </span>
            {r.boundary.sides.length > 0 && (
              <ul>
                {r.boundary.sides.map((s, i) => (
                  <li key={i}>
                    {s.side === "unknown" ? "Side" : SIDE_LABEL[s.side]}: {ft(s.lengthFt)}
                    {s.bearing ? ` · ${s.bearing}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {r.boundary.description && <span>{r.boundary.description}</span>}
          </>,
        )}
        {card(
          "Lot dimensions",
          <>
            <span className="text-foreground">
              {ft(r.lot.widthFt)} wide × {ft(r.lot.depthFt)} deep
            </span>
            <span>Area: {sqft(r.lot.areaSqFt)}</span>
            {r.lot.source && <span className="text-xs">“{r.lot.source}”</span>}
          </>,
          r.confidence.lot,
        )}
        {card(
          "Orientation",
          <>
            <span className="text-foreground">
              {r.orientation.northArrow ? "North arrow shown" : "No north arrow found"}
              {r.orientation.frontFaces ? ` · front faces ${r.orientation.frontFaces}` : ""}
            </span>
            {r.orientation.note && <span>{r.orientation.note}</span>}
          </>,
          r.confidence.orientation,
        )}
        {card(
          "Road frontage / access",
          <>
            <span className="text-foreground">{r.frontage.street ?? "Street not named"}</span>
            {r.frontage.cornerLot && (
              <span>
                Corner lot{r.frontage.secondStreet ? ` — also on ${r.frontage.secondStreet}` : ""}
              </span>
            )}
            {r.frontage.access && <span>{r.frontage.access}</span>}
          </>,
        )}
        {card(
          "Easements & no-build areas",
          r.easements.length + r.noBuildAreas.length === 0 ? (
            <span>None shown</span>
          ) : (
            <ul>
              {r.easements.map((e, i) => (
                <li key={`e${i}`}>
                  <span className="capitalize text-foreground">{e.type}</span> ·{" "}
                  {e.side === "interior" || e.side === "unknown"
                    ? e.side
                    : SIDE_LABEL[e.side].toLowerCase()}{" "}
                  · {ft(e.widthFt)}
                  {e.label ? ` (“${e.label}”)` : ""}
                </li>
              ))}
              {r.noBuildAreas.map((n, i) => (
                <li key={`n${i}`}>
                  <span className="text-foreground">{n.description}</span> · {n.side} ·{" "}
                  {ft(n.depthFt)}
                </li>
              ))}
            </ul>
          ),
          r.confidence.easements,
        )}
        {card(
          "Setback lines on the survey",
          <ul>
            {SIDES.map((s) => (
              <li key={s}>
                {SIDE_LABEL[s]}:{" "}
                {r.setbacks[s].ft != null ? (
                  <span className="text-foreground">
                    {ft(r.setbacks[s].ft)}
                    {r.setbacks[s].label ? ` (“${r.setbacks[s].label}”)` : ""}
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">not shown</span>
                )}
              </li>
            ))}
          </ul>,
          r.confidence.setbacks,
        )}
        {card(
          "Building envelope / usable area",
          <>
            <span className="text-foreground">
              {r.envelope.shown ? "Drawn on the survey" : "Not drawn on the survey"}
              {r.envelope.widthFt && r.envelope.depthFt
                ? ` · ${ft(r.envelope.widthFt)} × ${ft(r.envelope.depthFt)}`
                : ""}
              {r.envelope.areaSqFt ? ` · ${sqft(r.envelope.areaSqFt)}` : ""}
            </span>
            {r.envelope.note && <span>{r.envelope.note}</span>}
          </>,
        )}
        {card(
          "Labels & notes",
          <>
            {r.labels.legalDescription && (
              <span className="text-foreground">{r.labels.legalDescription}</span>
            )}
            {r.labels.address && <span>{r.labels.address}</span>}
            {(r.labels.surveyor || r.labels.date) && (
              <span>
                {r.labels.surveyor}
                {r.labels.surveyor && r.labels.date ? " · " : ""}
                {r.labels.date}
              </span>
            )}
            {r.labels.notes.length > 0 && (
              <ul className="list-disc pl-4 text-xs">
                {r.labels.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {!r.labels.legalDescription && !r.labels.notes.length && !r.labels.surveyor && (
              <span>None found</span>
            )}
          </>,
        )}
        {r.existing.length > 0 &&
          card(
            "Already on the lot",
            <ul>
              {r.existing.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>,
          )}
      </div>
    </div>
  );
}

// Confirm or enter the values the fit and schematic steps rely on. Blank = use
// what the survey says; anything typed here wins over the survey.
function ConfirmValues({
  dr,
  r,
  refetch,
}: {
  dr: DesignRequestRow;
  r: Reading | null;
  refetch: () => Promise<unknown>;
}) {
  const inputs = dr.site_inputs ?? {};
  const toStr = (n: number | null | undefined) => (n == null ? "" : String(n));
  const [form, setForm] = useState({
    lotWidthFt: toStr(inputs.lotWidthFt),
    lotDepthFt: toStr(inputs.lotDepthFt),
    front: toStr(inputs.setbacks?.front),
    rear: toStr(inputs.setbacks?.rear),
    left: toStr(inputs.setbacks?.left),
    right: toStr(inputs.setbacks?.right),
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const parse = (s: string) => {
    const n = Number(s.replace(/[^\d.]/g, ""));
    return s.trim() && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const draft: SiteInputs = {
    lotWidthFt: parse(form.lotWidthFt),
    lotDepthFt: parse(form.lotDepthFt),
    setbacks: {
      front: parse(form.front),
      rear: parse(form.rear),
      left: parse(form.left),
      right: parse(form.right),
    },
  };
  const v = siteValues(r, draft);
  const missing = missingSiteValues(v);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await saveSiteInputs(dr.id, draft);
      await refetch();
      setMsg(
        missing.length
          ? `Saved. Still needed: ${missing.join(", ")}.`
          : "Saved — the site details are complete.",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form, label: string, val: Sourced) => {
    const needs = val.value == null;
    return (
      <label key={key} className="grid min-w-0 gap-1 text-sm">
        <span className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-medium text-muted-foreground">
          {label} (ft)
          {val.source === "survey" && (
            <span className="text-emerald-700 dark:text-emerald-400">from survey</span>
          )}
          {val.source === "you" && <span className="text-accent">entered by you</span>}
          {needs && (
            <span className="font-semibold text-amber-700 dark:text-amber-400">needed</span>
          )}
        </span>
        <input
          inputMode="decimal"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={
            val.source === "survey" && val.value != null ? `${val.value} (survey)` : "Enter"
          }
          aria-label={`${label} in feet`}
          className={`w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm ${needs ? "border-amber-500" : "border-input"}`}
        />
      </label>
    );
  };
  return (
    <div className="mt-5 rounded-lg border border-border p-4">
      <div className="text-sm font-semibold">Confirm or enter the site details</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Leave a box empty to use what the survey says. Anything you type replaces the survey value.
        Left and right are as seen from the street, facing the lot.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {field("lotWidthFt", "Lot width", v.lotWidth)}
        {field("lotDepthFt", "Lot depth", v.lotDepth)}
        {field("front", "Front setback", v.setbacks.front)}
        {field("rear", "Rear setback", v.setbacks.rear)}
        {field("left", "Left side setback", v.setbacks.left)}
        {field("right", "Right side setback", v.setbacks.right)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="btn-accent text-sm"
        >
          {saving ? "Saving…" : "Save site details"}
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {msg ??
            (missing.length ? `Still needed: ${missing.join(", ")}` : "All site details are in.")}
        </span>
      </div>
    </div>
  );
}
