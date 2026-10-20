import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { DesignRequestRow } from "@/lib/design-requests";
import type { SiteFit } from "@/lib/site-fit";
import type { SurveyReading } from "@/lib/survey-reading";
import type { Rect, SchematicOption } from "@/lib/schematic";
import { planToImage, surveyImage, type SurveyImage } from "@/lib/survey-image";

// The uploaded survey with the plan laid over the lot outline Corvus AI found
// on it (or the survey on its own). PDFs are drawn page-first in the browser.
export function SurveyOverlay({
  dr,
  fit,
  reading,
  option,
  overlay,
}: {
  dr: DesignRequestRow;
  fit: SiteFit;
  reading: SurveyReading | null;
  option: SchematicOption | null;
  overlay: boolean;
}) {
  const placement = reading?.placement ?? null;
  const [img, setImg] = useState<SurveyImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.75);
  useEffect(() => {
    if (!dr.survey_path) return;
    let live = true;
    setImg(null);
    setError(null);
    surveyImage(dr.survey_path, dr.survey_type, placement?.page ?? 1)
      .then((i) => live && setImg(i))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't show the survey."));
    return () => {
      live = false;
    };
  }, [dr.survey_path, dr.survey_type, placement?.page]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!img)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {dr.survey_type === "application/pdf" ? "Drawing the PDF survey…" : "Loading the survey…"}
      </p>
    );

  const canOverlay = overlay && !!placement?.box && !!fit.lot && !!fit.limits;
  const map = canOverlay ? planToImage(placement!, img, fit.lot!) : null;
  const poly = (r: Rect) =>
    [map!(r.x, r.y), map!(r.x + r.w, r.y), map!(r.x + r.w, r.y + r.d), map!(r.x, r.y + r.d)]
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  const lot = fit.lot,
    L = fit.limits;
  const stroke = Math.max(2, img.width / 400);
  return (
    <figure className="min-w-0">
      <div className="relative overflow-hidden rounded-lg border border-border bg-white">
        <img
          src={img.src}
          alt={`Land survey: ${dr.survey_name ?? "uploaded file"}`}
          className="block h-auto w-full"
        />
        {canOverlay && lot && L && (
          <svg
            viewBox={`0 0 ${img.width} ${img.height}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            role="img"
            aria-label="Schematic plan laid over the survey"
            style={{ opacity }}
          >
            <polygon
              points={poly({ x: 0, y: 0, w: lot.widthFt, d: lot.depthFt })}
              fill="#fbbf24"
              fillOpacity={0.15}
              stroke="#b45309"
              strokeWidth={stroke}
            />
            <polygon
              points={poly({
                x: L.left.ft,
                y: L.front.ft,
                w: lot.widthFt - L.left.ft - L.right.ft,
                d: lot.depthFt - L.front.ft - L.rear.ft,
              })}
              fill="#ffffff"
              fillOpacity={0.35}
              stroke="#059669"
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 3}`}
            />
            {option?.parking && (
              <polygon
                points={poly(option.parking)}
                fill="#64748b"
                fillOpacity={0.35}
                stroke="#475569"
                strokeWidth={stroke * 0.7}
              />
            )}
            {option?.driveway && (
              <polygon
                points={poly({
                  x: option.driveway.x,
                  y: 0,
                  w: option.driveway.w,
                  d: option.driveway.toY,
                })}
                fill="#64748b"
                fillOpacity={0.35}
                stroke="#475569"
                strokeWidth={stroke * 0.7}
              />
            )}
            {(option?.building ?? []).map((b, i) => (
              <polygon
                key={i}
                points={poly(b)}
                fill="#0ea5e9"
                fillOpacity={0.45}
                stroke="#0369a1"
                strokeWidth={stroke}
              />
            ))}
          </svg>
        )}
      </div>
      {overlay && !placement?.box ? (
        <figcaption className="mt-2 text-sm">
          Corvus AI couldn&apos;t locate the lot on this survey to line the plan up with it.{" "}
          <Link to="/dashboard/design-survey" className="text-accent underline">
            Read the survey again
          </Link>{" "}
          or use the plan view.
        </figcaption>
      ) : canOverlay ? (
        <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Plan opacity
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="Plan opacity"
            />
          </label>
          <span>
            * Alignment is approximate — fitted to the lot outline Corvus AI found on the survey.
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
