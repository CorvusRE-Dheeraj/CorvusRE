import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { listDailyLogs, addDailyLog, deleteDailyLog } from "@/lib/project-activity";
import { Section, EmptyProject, Loading, Field, inputCls } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/daily-log")({
  head: () => ({ meta: [{ title: "Daily Construction Log — CorvusDP" }] }),
  component: DailyLog,
});

function DailyLog() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const logs = useQuery({
    queryKey: ["daily-logs", projectId],
    queryFn: () => listDailyLogs(projectId!),
    enabled: !!projectId,
  });

  const [form, setForm] = useState({
    logDate: new Date().toISOString().slice(0, 10),
    weather: "",
    crewCount: "",
    workPerformed: "",
    deliveries: "",
    delaysIssues: "",
  });
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !form.workPerformed.trim()) return;
    setSaving(true);
    await addDailyLog({
      projectId,
      logDate: form.logDate,
      weather: form.weather || undefined,
      crewCount: form.crewCount ? Number(form.crewCount) : null,
      workPerformed: form.workPerformed,
      deliveries: form.deliveries || undefined,
      delaysIssues: form.delaysIssues || undefined,
    });
    setForm({
      logDate: new Date().toISOString().slice(0, 10),
      weather: "",
      crewCount: "",
      workPerformed: "",
      deliveries: "",
      delaysIssues: "",
    });
    setSaving(false);
    logs.refetch();
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Daily construction log"
        subtitle="Weather, crews, work performed, deliveries, and issues — one entry per day (PRD 2.3.6.2)."
        right={
          <button className="btn-outline text-sm" onClick={() => window.print()}>
            Export / print
          </button>
        }
      >
        {logs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (logs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No log entries yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(logs.data ?? []).map((l, i) => (
              <li
                key={l.id}
                className="list-item-enter rounded-lg border border-border p-3 text-sm"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{dateShort(l.log_date)}</span>
                  <span className="text-xs text-muted-foreground">
                    {[l.weather, l.crew_count != null ? `${l.crew_count} on site` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{l.work_performed}</p>
                {l.deliveries && <p className="mt-1 text-xs">Deliveries: {l.deliveries}</p>}
                {l.delays_issues && (
                  <p className="mt-1 text-xs text-destructive">Delays/issues: {l.delays_issues}</p>
                )}
                <button
                  className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                  onClick={async () => {
                    await deleteDailyLog(l.id);
                    logs.refetch();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Add today's entry</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date">
              <input
                type="date"
                className={inputCls}
                value={form.logDate}
                onChange={(e) => setForm({ ...form, logDate: e.target.value })}
              />
            </Field>
            <Field label="Weather" hint="Optional">
              <input
                className={inputCls}
                value={form.weather}
                onChange={(e) => setForm({ ...form, weather: e.target.value })}
              />
            </Field>
            <Field label="Crew on site" hint="Optional">
              <input
                type="number"
                min="0"
                className={inputCls}
                value={form.crewCount}
                onChange={(e) => setForm({ ...form, crewCount: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Work performed" required>
            <textarea
              required
              rows={2}
              className={inputCls}
              value={form.workPerformed}
              onChange={(e) => setForm({ ...form, workPerformed: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deliveries" hint="Optional">
              <input
                className={inputCls}
                value={form.deliveries}
                onChange={(e) => setForm({ ...form, deliveries: e.target.value })}
              />
            </Field>
            <Field label="Delays / issues" hint="Optional">
              <input
                className={inputCls}
                value={form.delaysIssues}
                onChange={(e) => setForm({ ...form, delaysIssues: e.target.value })}
              />
            </Field>
          </div>
          <button className="btn-accent w-fit disabled:opacity-60" disabled={saving}>
            {saving ? "Saving…" : "Add entry"}
          </button>
        </form>
      </Section>
    </div>
  );
}
