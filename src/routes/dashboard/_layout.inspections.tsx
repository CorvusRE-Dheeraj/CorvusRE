import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import {
  listInspections,
  addInspection,
  setInspectionStatus,
  deleteInspection,
} from "@/lib/project-activity";
import { Section, Pill, EmptyProject, Loading, Field, inputCls, humanize } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/inspections")({
  head: () => ({ meta: [{ title: "Inspections — CorvusDP" }] }),
  component: Inspections,
});

const STATUS_TONE: Record<string, "gray" | "amber" | "red" | "green" | "blue"> = {
  scheduled: "blue",
  passed: "green",
  failed: "red",
  re_inspection_needed: "amber",
};

function Inspections() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();
  const projectId = project?.id;
  const inspections = useQuery({
    queryKey: ["inspections", projectId],
    queryFn: () => listInspections(projectId!),
    enabled: !!projectId,
  });

  const [form, setForm] = useState({ name: "", permitId: "", scheduledDate: "", notes: "" });
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const permits = bundle?.permits ?? [];
  const approvedPermits = permits.filter((p) => p.status === "approved");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !form.name.trim()) return;
    setSaving(true);
    await addInspection({
      projectId,
      permitId: form.permitId || null,
      name: form.name,
      scheduledDate: form.scheduledDate || null,
      notes: form.notes || undefined,
    });
    setForm({ name: "", permitId: "", scheduledDate: "", notes: "" });
    setSaving(false);
    inspections.refetch();
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Inspections"
        subtitle="Track required inspections from scheduling through pass/fail — the step between permit approval and closeout."
        right={
          <button className="btn-outline text-sm" onClick={() => window.print()}>
            Export / print
          </button>
        }
      >
        {approvedPermits.length === 0 && (
          <p className="mb-4 text-xs text-muted-foreground">
            No approved permits yet — inspections are usually scheduled once a permit is approved,
            but you can log one any time.
          </p>
        )}

        {inspections.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (inspections.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No inspections logged yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(inspections.data ?? []).map((i) => {
              const permit = permits.find((p) => p.id === i.permit_id);
              return (
                <li key={i.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{i.name}</span>
                      {permit && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {permit.name}
                        </span>
                      )}
                    </div>
                    <Pill tone={STATUS_TONE[i.status] ?? "gray"}>{humanize(i.status)}</Pill>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Scheduled: {i.scheduled_date ? dateShort(i.scheduled_date) : "—"}</span>
                    {i.notes && <span>{i.notes}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["scheduled", "passed", "failed", "re_inspection_needed"] as const)
                      .filter((s) => s !== i.status)
                      .map((s) => (
                        <button
                          key={s}
                          className="text-xs text-accent underline underline-offset-2"
                          onClick={async () => {
                            await setInspectionStatus(i.id, s);
                            inspections.refetch();
                          }}
                        >
                          Mark {humanize(s)}
                        </button>
                      ))}
                    <button
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                      onClick={async () => {
                        await deleteInspection(i.id);
                        inspections.refetch();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Log an inspection</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inspection name" required>
              <input
                required
                className={inputCls}
                placeholder="e.g. Foundation, Framing, Final"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Related permit" hint="Optional">
              <select
                className={inputCls}
                value={form.permitId}
                onChange={(e) => setForm({ ...form, permitId: e.target.value })}
              >
                <option value="">None</option>
                {permits.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scheduled date" hint="Optional">
              <input
                type="date"
                className={inputCls}
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
              />
            </Field>
            <Field label="Notes" hint="Optional">
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
          <button className="btn-accent w-fit disabled:opacity-60" disabled={saving}>
            {saving ? "Saving…" : "Add inspection"}
          </button>
        </form>
      </Section>
    </div>
  );
}
