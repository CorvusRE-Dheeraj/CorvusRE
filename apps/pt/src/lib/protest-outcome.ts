// How a COMPLETED protest's real result reads, once there's an actual value
// reduction to grade — separate from Module 1's pre-protest "opportunity"
// score (health-score.ts), which measures something else entirely (is this
// worth protesting) and stops being the right number to show once the case
// is already closed and won. Product-specified bands.
export type ProtestOutcomeTier = {
  label: string;
  message: string;
  // "muted" for the zero-reduction case (nothing to be alarmed about — the
  // assessment just held), "success" for every real reduction, however
  // small — even the "Good" 0-5% band is a genuine win, not a weak result.
  tone: "muted" | "success";
};

const TIERS: { max: number; label: string; message: string }[] = [
  { max: 0, label: "Try again next year", message: "The protest did not result in a reduction." },
  { max: 5, label: "Good Protest Outcome", message: "The protest resulted in some reduction." },
  {
    max: 10,
    label: "Very Good Protest Outcome",
    message: "A meaningful reduction was achieved.",
  },
  { max: 15, label: "Excellent Protest Outcome", message: "A strong reduction was achieved." },
  {
    max: 25,
    label: "Exceptional Protest Outcome",
    message: "A significant reduction was achieved.",
  },
  {
    max: Infinity,
    label: "Outstanding Protest Outcome",
    message: "A substantial reduction was achieved.",
  },
];

export function protestOutcome(valueReductionPct: number | null | undefined): ProtestOutcomeTier {
  const pct = valueReductionPct ?? 0;
  const tier = TIERS.find((t) => pct <= t.max) ?? TIERS[TIERS.length - 1];
  return { label: tier.label, message: tier.message, tone: pct > 0 ? "success" : "muted" };
}
