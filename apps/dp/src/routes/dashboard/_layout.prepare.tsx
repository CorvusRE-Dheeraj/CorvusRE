import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { useAuth } from "@/lib/auth";
import { checklistCompletion } from "@/lib/checklist";
import { createEngagementRequest, getEngagementRequest } from "@/lib/engagements";
import { currencyRange, weeksLabel, dateShort } from "@/lib/format";
import { Section, Stat, EmptyProject, Loading, Field, inputCls } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/prepare")({
  head: () => ({ meta: [{ title: "Application Preparation — CorvusDP" }] }),
  component: Prepare,
});

function Prepare() {
  const { user } = useAuth();
  const { loading, hasProject, project, bundle } = useActiveProjectBundle();
  const projectId = project?.id;
  const eng = useQuery({
    queryKey: ["engagement", projectId],
    queryFn: () => getEngagementRequest(projectId!),
    enabled: !!projectId,
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // `busy` only disables the button on the NEXT render, so several clicks
  // dispatched before React re-renders all sailed through — a fast
  // double-click produced two engagement_requests rows, two in-app
  // notifications and two staff emails. This latch is synchronous.
  const submittingRef = useRef(false);

  if (loading) return <Loading />;
  if (!hasProject || !project?.analysis) return <EmptyProject />;

  const a = project.analysis;
  const submissionItems = (bundle?.checklist ?? []).filter((c) => c.kind !== "pre_app");
  const completion = checklistCompletion(submissionItems);
  const missing = submissionItems.filter((c) => c.required && !c.done);

  async function requestEngagement() {
    if (!projectId || !user) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    const scope = `${a.permits.length} permits · ${a.complexity.level} complexity · ${a.jurisdiction.authority} · est. ${weeksLabel(a.timeline.totalWeeksMin, a.timeline.totalWeeksMax)} · fees ${currencyRange(a.fees.totalLow, a.fees.totalHigh)}`;
    try {
      // Re-check server-side as well, so a second tab (or a stale copy of
      // this page) can't file a duplicate request either.
      const existing = await getEngagementRequest(projectId);
      if (existing) {
        await eng.refetch();
        return;
      }
      await createEngagementRequest({
        userId: user.id,
        projectId,
        scopeSummary: scope,
        note,
        requesterEmail: user.email ?? undefined,
        projectAddress: project.address ?? project.name ?? undefined,
      });
      await eng.refetch();
      setNote("");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Application preparation summary"
        subtitle="How ready your submission package is against the city-specific checklist."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Checklist completion"
            value={`${completion}%`}
            hint={`${submissionItems.length} items`}
          />
          <Stat label="Completed" value={submissionItems.filter((c) => c.done).length} />
          <Stat label="Missing (required)" value={missing.length} />
        </div>
        {missing.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-semibold">⚠ Outstanding required items</div>
            <ul className="mt-2 grid gap-1 text-sm">
              {missing.map((c) => (
                <li key={c.id} className="text-muted-foreground">
                  • {c.label} <span className="text-[10px] uppercase">({c.grp})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="Design responsibility matrix"
        subtitle="Which consultant owns each deliverable."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2 font-medium">Requirement</th>
                <th className="px-2 py-2 font-medium">Responsible consultant</th>
              </tr>
            </thead>
            <tbody>
              {a.responsibilityMatrix.map((r, i) => (
                <tr key={i} className="row-hover border-b border-border/60">
                  <td className="px-2 py-2">{r.requirement}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.consultant}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Proceed with professional assistance"
        subtitle="Have CorvusDP's team prepare and run the permit submission for you."
      >
        {eng.data ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
            <div className="font-medium">Request received — {dateShort(eng.data.created_at)}</div>
            <p className="mt-1 text-muted-foreground">
              Status: {eng.data.status}. We'll follow up with a scope of services, estimated
              professional fees, and a payment schedule.
            </p>
            {eng.data.scope_summary && (
              <p className="mt-1 text-xs text-muted-foreground">
                Scope snapshot: {eng.data.scope_summary}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Anything we should know? (optional)">
              <textarea
                className={inputCls}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <button
              className="btn-accent w-fit disabled:opacity-60"
              disabled={busy}
              onClick={requestEngagement}
            >
              {busy ? "Sending…" : "Request professional assistance"}
            </button>
            <p className="text-xs text-muted-foreground">
              No charge to request. E-signature and payment are handled outside this build.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
