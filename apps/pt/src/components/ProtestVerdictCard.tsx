import { Link } from "@tanstack/react-router";
import { CheckCircle2, CircleHelp, Clock, Info, ThumbsDown, TriangleAlert } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import type { PropertyAiScore } from "@/lib/property-scores";
import { getPropertyProtestStatus } from "@/lib/portfolio-status";
import {
  protestVerdict,
  usualDeadlinePassed,
  type ProtestVerdict,
  type VerdictTone,
} from "@/lib/protest-verdict";

const TONE: Record<VerdictTone, { box: string; icon: string; Icon: typeof Info }> = {
  good: {
    box: "border-emerald-500/30 bg-emerald-500/10",
    icon: "bg-emerald-700",
    Icon: CheckCircle2,
  },
  maybe: { box: "border-amber-500/30 bg-amber-500/10", icon: "bg-amber-700", Icon: CircleHelp },
  no: { box: "border-slate-400/30 bg-slate-500/10", icon: "bg-slate-600", Icon: ThumbsDown },
  info: { box: "border-sky-500/30 bg-sky-500/10", icon: "bg-sky-700", Icon: Info },
  warn: { box: "border-rose-500/30 bg-rose-500/10", icon: "bg-rose-700", Icon: TriangleAlert },
  done: { box: "border-emerald-500/30 bg-emerald-500/10", icon: "bg-emerald-700", Icon: Clock },
};

export function verdictFor(
  property: PropertyRecord,
  protests: ProtestRecord[],
  score: PropertyAiScore | undefined,
): ProtestVerdict {
  const protest = protests.find((p) => p.propertyId === property.id);
  const status = getPropertyProtestStatus(property, protests);
  return protestVerdict({
    score: score ? score.score : null,
    daysLeft: property.protestDeadline
      ? Math.ceil((new Date(property.protestDeadline).getTime() - Date.now()) / 86_400_000)
      : null,
    usualDeadlinePassed: !property.protestDeadline && usualDeadlinePassed(),
    estimatedSavings: property.estimatedSavings,
    hasProtest: !!protest,
    protestResolved: protest?.status === "resolved",
    protestStageLabel: protest ? status.label : null,
  });
}

// A small coloured chip for list rows, e.g. "Worth protesting".
export function VerdictChip({ verdict }: { verdict: ProtestVerdict }) {
  const t = TONE[verdict.tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${t.box}`}
    >
      {verdict.headline}
    </span>
  );
}

// The answer to "can I protest, and is it worth it?" for each of the user's properties,
// at the top of the dashboard. One plain sentence and one button per property.
export function ProtestVerdictCard({
  properties,
  protests,
  healthScores,
  onOpenReport,
}: {
  properties: PropertyRecord[];
  protests: ProtestRecord[];
  healthScores: Record<string, PropertyAiScore>;
  onOpenReport: (p: PropertyRecord) => void;
}) {
  if (properties.length === 0) return null;
  // Best news and open cases first, so the most useful answers are at the top.
  const order: VerdictTone[] = ["good", "maybe", "info", "warn", "no", "done"];
  const shown = properties
    .map((p) => ({ p, v: verdictFor(p, protests, healthScores[p.id]) }))
    .sort((a, b) => order.indexOf(a.v.tone) - order.indexOf(b.v.tone))
    .slice(0, 5);
  return (
    <section aria-labelledby="verdict-heading" className="grid gap-3">
      <div>
        <h2 id="verdict-heading" className="font-serif text-xl font-bold">
          Can I protest?
        </h2>
        <p className="text-sm text-muted-foreground">
          Our quick answer for each property. Open it for the full reasons.
        </p>
      </div>
      <ul className="grid gap-3">
        {shown.map(({ p, v }) => {
          const t = TONE[v.tone];
          const Icon = t.Icon;
          const btn = "btn-primary shrink-0 text-sm";
          return (
            <li
              key={p.id}
              className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${t.box}`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white ${t.icon}`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="truncate text-xs text-muted-foreground">{p.address}</div>
                <div className="font-serif text-base font-semibold">{v.headline}</div>
                <p className="text-sm text-muted-foreground">{v.detail}</p>
              </div>
              {v.action === "case" && (
                <Link to="/dashboard/case" search={{ propertyId: p.id }} className={btn}>
                  {v.actionLabel} →
                </Link>
              )}
              {v.action === "upload" && (
                <Link to="/dashboard/documents" search={{ propertyId: p.id }} className={btn}>
                  {v.actionLabel} →
                </Link>
              )}
              {v.action === "report" && (
                <button type="button" onClick={() => onOpenReport(p)} className={btn}>
                  {v.actionLabel} →
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {properties.length > shown.length && (
        <Link to="/dashboard/properties" className="text-sm text-accent hover:underline">
          See all {properties.length} properties →
        </Link>
      )}
    </section>
  );
}
