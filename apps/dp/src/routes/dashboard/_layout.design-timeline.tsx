import { createFileRoute } from "@tanstack/react-router";
import { designSchedule, addWeeks } from "@/lib/design-workspace";
import { DESIGN_STAGE_LABEL, type DesignStage } from "@/lib/design-requests";
import { weeksLabel, dateShort } from "@/lib/format";
import { Section, Stat, Loading } from "@/components/dp-ui";
import { useActiveDesignRequest, EmptyDesign, designSubtitle } from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-timeline")({
  head: () => ({ meta: [{ title: "Design Timeline — CorvusDP" }] }),
  component: DesignTimeline,
});

function DesignTimeline() {
  const { loading, dr, brief: b } = useActiveDesignRequest();
  if (loading) return <Loading />;
  if (!dr || !b) return <EmptyDesign />;

  const phases = designSchedule(b);
  const span = Math.max(1, b.totalWeeksMax);
  const start = dr.approved_at;
  const fmt = (weeks: number) => (start ? dateShort(addWeeks(start, weeks).toISOString()) : null);

  return (
    <div className="grid gap-5">
      <Section title="Design timeline" subtitle={designSubtitle(dr)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Total duration" value={weeksLabel(b.totalWeeksMin, b.totalWeeksMax)} />
          <Stat
            label="Current stage"
            value={DESIGN_STAGE_LABEL[dr.stage as DesignStage] ?? dr.stage}
          />
          <Stat
            label={start ? "Permit set expected" : "Starts"}
            value={
              start
                ? `${fmt(b.totalWeeksMin)} – ${fmt(b.totalWeeksMax)}`
                : "When you approve the brief"
            }
          />
        </div>
      </Section>

      <Section
        title="Phase schedule"
        subtitle={
          start
            ? `Counted from your approval on ${dateShort(start)}. The solid bar is the fastest case; the light bar shows how far it can stretch.`
            : "Week ranges from the day you approve the brief. The solid bar is the fastest case; the light bar shows how far it can stretch."
        }
      >
        <div className="grid gap-4">
          {phases.map((p) => (
            <div key={p.phase} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{p.phase}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {start
                    ? `${fmt(p.startMin)} – ${fmt(p.endMax)}`
                    : `Weeks ${p.startMin + 1}–${p.endMax}`}{" "}
                  · {weeksLabel(p.weeksMin, p.weeksMax)}
                </span>
              </div>
              <div className="relative mt-1.5 h-3 rounded-full bg-secondary">
                <div
                  className="absolute inset-y-0 rounded-full bg-accent/25"
                  style={{
                    left: `${(p.startMin / span) * 100}%`,
                    width: `${((p.endMax - p.startMin) / span) * 100}%`,
                  }}
                  aria-hidden
                />
                <div
                  className="absolute inset-y-0 rounded-full bg-accent"
                  style={{
                    left: `${(p.startMin / span) * 100}%`,
                    width: `${((p.endMin - p.startMin) / span) * 100}%`,
                  }}
                  aria-hidden
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
            </div>
          ))}
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>Week 0</span>
            <span>Week {span}</span>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Durations are typical ranges — they move with project size, feedback speed, and the number
          of revision cycles.
        </p>
      </Section>
    </div>
  );
}
