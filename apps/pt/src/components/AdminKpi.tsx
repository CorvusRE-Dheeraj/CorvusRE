// Shared by every admin-panel chart/stat tile (admin.tsx's Financials tab,
// AdminBetaFeedback.tsx's Insights tab) — pulled out of admin.tsx itself so
// a component doesn't have to import from a route file (which would make
// admin.tsx and AdminBetaFeedback.tsx import each other) just to reuse a
// palette and a stat tile.
export const CHART_COLORS = [
  "var(--accent)",
  "oklch(0.62 0.17 155)",
  "oklch(0.78 0.19 75)",
  "oklch(0.58 0.22 27)",
  "oklch(0.48 0.02 255)",
];

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-elev p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
