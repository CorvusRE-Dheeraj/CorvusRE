import { useId } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { currency } from "@/lib/intake-store";
import type { CadValueHistoryEntry } from "@/lib/cad-lookup";

// Extracted from the /intake confirm screen (originally inline there only) so it can
// also be shown again later on the AI Report page once a saved property's value
// history round-trips through the DB — see src/lib/properties.ts's valueHistory
// field. Behavior is unchanged from the original inline version.
function ValueHistoryChart({ history }: { history: CadValueHistoryEntry[] }) {
  const gradientId = useId();
  const points = history
    .filter((h) => h.appraisedValue != null)
    .sort((a, b) => a.year - b.year)
    .map((h) => ({ year: String(h.year), value: h.appraisedValue as number }));

  // Need at least two real points to draw a trend — a single year is just a dot.
  if (points.length < 2) return null;

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const changePct = first !== 0 ? Math.round(((last - first) / first) * 100) : 0;
  // Rising assessed value is the thing worth flagging to a taxpayer (usually means
  // a higher bill), so it's colored as a caution, not a plain neutral trend line.
  const color = changePct > 0 ? "var(--warning)" : changePct < 0 ? "var(--success)" : "var(--muted-foreground)";

  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold" style={{ color }}>
          {changePct > 0 ? "+" : ""}
          {changePct}%
        </span>
        <span className="text-xs text-muted-foreground">
          since {points[0].year} ({currency(first)} → {currency(last)})
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis hide domain={["dataMin - dataMin * 0.05", "dataMax + dataMax * 0.05"]} />
          <Tooltip formatter={(v: number) => currency(v)} labelFormatter={(l) => `Year ${l}`} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ValueHistorySection({ history }: { history: CadValueHistoryEntry[] }) {
  // A CAD can return one row per year going back a decade-plus with every value
  // field null (the year existed in the county's system, but nothing was published
  // for it) — showing a table that's entirely dashes isn't useful, so only real rows
  // count, and the whole section stays hidden unless at least one does.
  const realHistory = history.filter(
    (v) => v.landValue != null || v.improvementValue != null || v.marketValue != null || v.appraisedValue != null,
  );
  if (realHistory.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Value History</h3>
      <ValueHistoryChart history={realHistory} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-4">Year</th>
              <th className="py-1 pr-4">Land</th>
              <th className="py-1 pr-4">Improvement</th>
              <th className="py-1 pr-4">Market</th>
              <th className="py-1 pr-4">Appraised</th>
            </tr>
          </thead>
          <tbody>
            {realHistory.map((v) => (
              <tr key={v.year} className="border-t border-border">
                <td className="py-1 pr-4">{v.year}</td>
                <td className="py-1 pr-4">{currency(v.landValue)}</td>
                <td className="py-1 pr-4">{currency(v.improvementValue)}</td>
                <td className="py-1 pr-4">{currency(v.marketValue)}</td>
                <td className="py-1 pr-4">{currency(v.appraisedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
