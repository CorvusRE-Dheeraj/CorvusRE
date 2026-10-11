import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { designRoadmap, type RoadmapStatus } from "@/lib/design-workspace";
import { Section, Pill, Loading } from "@/components/dp-ui";
import { useActiveDesignRequest, EmptyDesign, designSubtitle } from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-roadmap")({
  head: () => ({ meta: [{ title: "Design Roadmap — CorvusDP" }] }),
  component: DesignRoadmap,
});

const STATUS_PILL: Record<RoadmapStatus, { tone: "green" | "blue" | "gray"; label: string }> = {
  done: { tone: "green", label: "Done" },
  current: { tone: "blue", label: "In progress" },
  upcoming: { tone: "gray", label: "Up next" },
};

function DesignRoadmap() {
  const { loading, dr, brief } = useActiveDesignRequest();
  if (loading) return <Loading />;
  if (!dr || !brief) return <EmptyDesign />;

  const steps = designRoadmap(dr, brief);

  return (
    <div className="grid gap-5">
      <Section
        title="Design roadmap"
        subtitle={`${designSubtitle(dr)} — what has to happen before what, and what runs side by side.`}
      >
        <ol className="relative grid gap-4">
          {steps.map((s, i) => {
            const pill = STATUS_PILL[s.status];
            return (
              <li key={s.key} className="relative flex gap-4">
                {i < steps.length - 1 && (
                  <span
                    className={`absolute left-4 top-9 h-[calc(100%-1.25rem)] w-px ${
                      s.status === "done" ? "bg-accent" : "bg-border"
                    }`}
                    aria-hidden
                  />
                )}
                <span
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    s.status === "done"
                      ? "bg-accent text-accent-foreground"
                      : s.status === "current"
                        ? "border-2 border-accent bg-background text-accent"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {s.status === "done" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.title}</span>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {s.after.length > 0 && <span>After: {s.after.join(" + ")}</span>}
                    {s.parallel && <span>In parallel: {s.parallel}</span>}
                  </div>
                  {s.key === "permitting" && (
                    <Link
                      to="/permitting/analyze"
                      className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
                    >
                      Start the permitting analysis for this property
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
    </div>
  );
}
