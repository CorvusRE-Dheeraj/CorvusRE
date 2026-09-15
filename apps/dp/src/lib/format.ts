export function currency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function currencyRange(min: number, max: number): string {
  return `${currency(min)} – ${currency(max)}`;
}

export function weeksLabel(min: number, max: number): string {
  if (min === max) return `${min} week${min === 1 ? "" : "s"}`;
  return `${min}–${max} weeks`;
}

export function monthsFromWeeks(weeks: number): string {
  const m = weeks / 4.33;
  if (m < 1) return `${Math.round(weeks)} weeks`;
  return `${m.toFixed(m < 3 ? 1 : 0)} months`;
}

export function dateShort(iso: string | number | Date | null | undefined): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Whole days from `from` (defaults to now) to `iso` — negative when `iso` is
// in the past. Used for permit aging (days since submission) and countdowns
// (days until expiry) in the admin ops views.
export function daysUntil(
  iso: string | number | Date | null | undefined,
  from: Date = new Date(),
): number | null {
  if (iso == null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - from.getTime()) / 86_400_000);
}

export function parseArea(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const cleaned = input.toLowerCase().replace(/,/g, "").trim();
  const m = cleaned.match(/([\d.]+)\s*(ac|acre|acres|sf|sq\s?ft|sqft|square feet)?/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2] ?? "";
  if (/ac/.test(unit)) return Math.round(value * 43560);
  return Math.round(value);
}
