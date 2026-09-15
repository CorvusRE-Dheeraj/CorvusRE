import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { markNotificationRead } from "@/lib/projects";
import { roadmapStatus } from "@/lib/roadmap";
import { currencyRange, weeksLabel, dateShort } from "@/lib/format";
import {
  Section,
  Stat,
  Pill,
  EmptyProject,
  Loading,
  humanize,
  feasibilityTone,
} from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/")({
  head: () => ({ meta: [{ title: "Dashboard — CorvusDP" }] }),
  component: DashboardHome,
});

function DashboardHome() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const analysis = project.analysis;
  const approvedIds = (bundle?.permits ?? [])
    .filter((p) => p.status === "approved")
    .map((p) => p.permit_key);
  const status = analysis ? roadmapStatus(analysis.roadmap, approvedIds) : null;
  const unread = (bundle?.notifications ?? []).filter((n) => !n.read);

  return (
    <div className="grid gap-5">
      <WelcomeWalkthrough />
      <Section
        title={project.name ?? project.address ?? "Your project"}
        subtitle={`${project.jurisdiction ?? "Jurisdiction pending"} · ${humanize(project.track)}`}
        right={
          <Pill tone={feasibilityTone(project.feasibility_status)}>
            {humanize(project.feasibility_status)}
          </Pill>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Current stage" value={humanize(project.stage)} hint={status?.currentPhase} />
          <Stat label="Complexity" value={humanize(project.complexity_level)} />
          <Stat
            label="Timeline estimate"
            value={
              analysis
                ? weeksLabel(analysis.timeline.totalWeeksMin, analysis.timeline.totalWeeksMax)
                : "—"
            }
          />
          <Stat
            label="Estimated cost"
            value={analysis ? currencyRange(analysis.fees.totalLow, analysis.fees.totalHigh) : "—"}
          />
        </div>
        {status && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Roadmap progress</span>
              <span className="text-muted-foreground">
                {status.completedPhases}/{status.totalPhases} phases · {status.percentComplete}%
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="progress-fill h-full rounded-full bg-accent"
                style={{ width: `${status.percentComplete}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Next: {status.nextStep}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/dashboard/permits" className="btn-accent">
            Continue project
          </Link>
          <Link to="/dashboard/roadmap" className="btn-outline">
            View roadmap
          </Link>
        </div>
      </Section>

      <Section
        title="Recent notifications"
        subtitle={unread.length ? `${unread.length} unread` : "All caught up"}
      >
        {(bundle?.notifications ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(bundle?.notifications ?? []).slice(0, 8).map((n) => (
              <li
                key={n.id}
                className={`rounded-lg border p-3 text-sm ${n.read ? "border-border" : "border-accent/40 bg-accent/5"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{n.title}</span>
                  <span className="text-xs text-muted-foreground">{dateShort(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-muted-foreground">{n.body}</p>}
                {!n.read && (
                  <button
                    onClick={async () => {
                      await markNotificationRead(n.id);
                      refetch();
                    }}
                    className="mt-1 text-xs text-accent underline underline-offset-2"
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// Welcome walkthrough (PRD 1.1.7.K) — shown once, dismissible.
const WALKTHROUGH_KEY = "corvusdp.walkthroughDismissed";

function WelcomeWalkthrough() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(WALKTHROUGH_KEY) === "1";
    } catch {
      return true;
    }
  });
  if (dismissed) return null;

  function close() {
    try {
      localStorage.setItem(WALKTHROUGH_KEY, "1");
    } catch {
      /* no-op */
    }
    setDismissed(true);
  }

  return (
    <div className="card-elev brand-gradient-soft p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold">Welcome to CorvusDP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's how the permitting dashboard works:
          </p>
        </div>
        <button
          onClick={close}
          className="text-sm text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
        <li>
          • <span className="text-foreground">Permits / Roadmap</span> — every permit, its agency,
          and the order to submit
        </li>
        <li>
          • <span className="text-foreground">Site Data</span> — utility & constraint summary +
          pre-app meeting agenda
        </li>
        <li>
          • <span className="text-foreground">Checklist / Prepare</span> — what to submit and who
          owns it
        </li>
        <li>
          • <span className="text-foreground">Reviews / City</span> — track cycles, comments, and
          jurisdiction contact
        </li>
        <li>
          • <span className="text-foreground">Approvals</span> — approved permits, clearance, and
          expiry
        </li>
        <li>
          • <span className="text-foreground">Alerts</span> — a log of every status change
        </li>
      </ul>
      <button onClick={close} className="btn-outline mt-4 text-sm">
        Got it
      </button>
    </div>
  );
}
