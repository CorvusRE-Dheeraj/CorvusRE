// Street View condition comparison — the pure part. The model rates the
// visible exterior condition in Street View images of the subject and its
// nearest comparables (streetview-condition edge function); this module
// clamps those ratings and does the comparison deterministically, so the
// same ratings always read the same way.
//
// What it can and can't show: Street View is exterior-only and dated, so an
// image older than STALE_YEARS or one where the building isn't clearly
// visible is reported with that caveat (or left out), never presented as
// current interior condition.

export type Rating = 1 | 2 | 3 | 4 | 5; // 1 = poor, 5 = excellent

export type ConditionRating = {
  usable: boolean; // the building is clearly visible
  overall: Rating | null;
  facade: Rating | null;
  roof: Rating | null; // often not visible from the street
  paving: Rating | null; // parking / drive / sidewalk
  site: Rating | null; // landscaping, fencing, signage, upkeep
  defects: string[]; // visible problems, short
};

export type RatedImage = {
  key: string; // "subject" or a comp key
  address: string;
  imageDate: string | null; // "YYYY-MM" from Street View metadata
  value: number | null; // county value (comps)
  rating: ConditionRating;
};

export const LIMITS = { defects: 5, defectChars: 120, images: 7 } as const;
export const STALE_YEARS = 3;

const rating = (v: unknown): Rating | null => {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? (n as Rating) : null;
};

export function sanitizeRating(raw: unknown): ConditionRating {
  const r = (raw ?? {}) as Record<string, unknown>;
  const usable = r.usable === true;
  return {
    usable,
    overall: usable ? rating(r.overall) : null,
    facade: usable ? rating(r.facade) : null,
    roof: usable ? rating(r.roof) : null,
    paving: usable ? rating(r.paving) : null,
    site: usable ? rating(r.site) : null,
    defects:
      usable && Array.isArray(r.defects)
        ? r.defects
            .filter(
              (d): d is string => typeof d === "string" && d.trim().length > 0,
            )
            .map((d) => d.trim().slice(0, LIMITS.defectChars))
            .slice(0, LIMITS.defects)
        : [],
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const yearsOld = (imageDate: string | null, today: string) => {
  if (!imageDate) return null;
  const [y, m] = imageDate.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  if (!y || !ty) return null;
  return Math.round((((ty - y) * 12 + ((tm || 1) - (m || 1))) / 12) * 10) / 10;
};

export type ConditionComparison = {
  subject: RatedImage | null;
  comps: RatedImage[]; // usable comps only
  compsMedian: number | null;
  gap: number | null; // compsMedian − subject overall (positive = subject worse)
  worseThan: number; // comps rated better than the subject
  betterThan: number;
  finding: "worse" | "similar" | "better" | "inconclusive";
  summary: string;
  caveats: string[];
};

// A gap of at least one full point on the 5-point scale is a visible difference.
export const MEANINGFUL_GAP = 1;

export function compareConditions(
  images: RatedImage[],
  today: string,
): ConditionComparison {
  const subject = images.find((i) => i.key === "subject") ?? null;
  const comps = images.filter(
    (i) => i.key !== "subject" && i.rating.usable && i.rating.overall,
  );
  const caveats: string[] = [
    "Street View shows the exterior only, as of the imagery date — not the interior or anything since.",
  ];
  const stale = images.filter(
    (i) => (yearsOld(i.imageDate, today) ?? 0) > STALE_YEARS,
  );
  if (stale.length)
    caveats.push(
      `${stale.length} of the images ${stale.length === 1 ? "is" : "are"} more than ${STALE_YEARS} years old; current photos would carry more weight.`,
    );
  const unusable = images.filter((i) => !i.rating.usable).length;
  if (unusable)
    caveats.push(
      `${unusable} image${unusable === 1 ? "" : "s"} didn't show the building clearly and ${unusable === 1 ? "was" : "were"} left out.`,
    );

  const s = subject?.rating.usable ? subject.rating.overall : null;
  if (s == null || comps.length < 2) {
    return {
      subject,
      comps,
      compsMedian: comps.length
        ? median(comps.map((c) => c.rating.overall!))
        : null,
      gap: null,
      worseThan: 0,
      betterThan: 0,
      finding: "inconclusive",
      summary:
        s == null
          ? "The subject's Street View image doesn't show the building clearly enough to rate."
          : "Fewer than two comparables had usable Street View images, so there's no comparison.",
      caveats,
    };
  }
  const compsMedian = median(comps.map((c) => c.rating.overall!));
  const gap = Math.round((compsMedian - s) * 10) / 10;
  const worseThan = comps.filter((c) => c.rating.overall! > s).length;
  const betterThan = comps.filter((c) => c.rating.overall! < s).length;
  const finding =
    gap >= MEANINGFUL_GAP
      ? "worse"
      : gap <= -MEANINGFUL_GAP
        ? "better"
        : "similar";
  const summary =
    finding === "worse"
      ? `Corvus rates the subject's visible exterior ${s}/5 against a ${compsMedian}/5 median for ${comps.length} comparables — rated below ${worseThan} of them. That may support a condition adjustment to consider alongside photos and repair bids.`
      : finding === "better"
        ? `Corvus rates the subject's visible exterior ${s}/5 against a ${compsMedian}/5 median for ${comps.length} comparables — in better visible condition than most. The district may point to that; condition isn't a strong argument here.`
        : `Corvus rates the subject's visible exterior ${s}/5, in line with the ${compsMedian}/5 median for ${comps.length} comparables — no visible condition difference to argue from the street.`;
  return {
    subject,
    comps,
    compsMedian,
    gap,
    worseThan,
    betterThan,
    finding,
    summary,
    caveats,
  };
}
