import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { listCityComms, addCityComm } from "@/lib/project-activity";
import { Section, Pill, EmptyProject, Loading, Field, inputCls } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/city")({
  head: () => ({ meta: [{ title: "City relationship — CorvusDP" }] }),
  component: City,
});

const CHANNEL_TONE: Record<string, "blue" | "amber" | "green" | "gray"> = {
  email: "blue",
  phone: "amber",
  meeting: "green",
  portal: "gray",
};

function City() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const comms = useQuery({
    queryKey: ["city-comms", projectId],
    queryFn: () => listCityComms(projectId!),
    enabled: !!projectId,
  });
  const [form, setForm] = useState({
    channel: "email",
    department: "",
    summary: "",
    next: "",
    push: false,
  });
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !form.summary.trim()) return;
    setSaving(true);
    await addCityComm({
      projectId,
      channel: form.channel,
      department: form.department || undefined,
      summary: form.summary,
      nextFollowUp: form.next || null,
      proactivePush: form.push,
    });
    setForm({ channel: "email", department: "", summary: "", next: "", push: false });
    setSaving(false);
    comms.refetch();
  }

  return (
    <div className="grid gap-5">
      <Section
        title="City relationship management tracker"
        subtitle="A manual log of calls, emails, and meetings with the jurisdiction — for reviewer comments on a submitted permit, see Reviews instead."
      >
        {comms.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (comms.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No communications logged yet.</p>
        ) : (
          <ol className="relative grid gap-3 border-l border-border pl-6">
            {(comms.data ?? []).map((c) => (
              <li key={c.id} className="relative">
                <span className="absolute -left-[1.65rem] mt-1.5 h-3 w-3 rounded-full border-2 border-accent bg-background" />
                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={CHANNEL_TONE[c.channel] ?? "gray"}>{c.channel}</Pill>
                    {c.proactive_push && <Pill tone="amber">proactive push</Pill>}
                    {c.department && (
                      <span className="text-xs text-muted-foreground">{c.department}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dateShort(c.occurred_at)}
                    </span>
                  </div>
                  <p className="mt-1">{c.summary}</p>
                  {c.next_follow_up && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next follow-up: {dateShort(c.next_follow_up)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Log an interaction</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Channel">
              <select
                className={inputCls}
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                {["email", "phone", "meeting", "portal"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="City department">
              <input
                className={inputCls}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Summary" required>
            <textarea
              required
              rows={2}
              className={inputCls}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Next follow-up date">
              <input
                type="date"
                className={inputCls}
                value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
              />
            </Field>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.push}
                onChange={(e) => setForm({ ...form, push: e.target.checked })}
              />
              Proactive push (expeditor-initiated)
            </label>
          </div>
          <button className="btn-accent w-fit disabled:opacity-60" disabled={saving}>
            {saving ? "Saving…" : "Add to timeline"}
          </button>
        </form>
      </Section>
    </div>
  );
}
