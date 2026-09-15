import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { listRfis, addRfi, respondToRfi, setRfiStatus } from "@/lib/project-activity";
import { Section, Pill, EmptyProject, Loading, Field, inputCls, humanize } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/rfis")({
  head: () => ({ meta: [{ title: "Submittals & RFIs — CorvusDP" }] }),
  component: Rfis,
});

const STATUS_TONE: Record<string, "gray" | "amber" | "green"> = {
  open: "amber",
  answered: "green",
  closed: "gray",
};

function Rfis() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const rfis = useQuery({
    queryKey: ["rfis", projectId],
    queryFn: () => listRfis(projectId!),
    enabled: !!projectId,
  });

  const [form, setForm] = useState({ subject: "", question: "", submittedTo: "", dueDate: "" });
  const [saving, setSaving] = useState(false);
  const [responding, setResponding] = useState<Record<string, string>>({});

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !form.subject.trim() || !form.question.trim()) return;
    setSaving(true);
    await addRfi({
      projectId,
      subject: form.subject,
      question: form.question,
      submittedTo: form.submittedTo || undefined,
      dueDate: form.dueDate || null,
    });
    setForm({ subject: "", question: "", submittedTo: "", dueDate: "" });
    setSaving(false);
    rfis.refetch();
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Submittals & RFIs"
        subtitle="Construction-phase questions to consultants and subs — a separate log from Reviews, which tracks the permitting/design review cycle."
        right={
          <button className="btn-outline text-sm" onClick={() => window.print()}>
            Export / print
          </button>
        }
      >
        {rfis.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (rfis.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No RFIs logged yet.</p>
        ) : (
          <ul className="grid gap-3">
            {(rfis.data ?? []).map((r, i) => (
              <li
                key={r.id}
                className="list-item-enter rounded-lg border border-border p-4 text-sm"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.subject}</span>
                  <Pill tone={STATUS_TONE[r.status] ?? "gray"}>{humanize(r.status)}</Pill>
                  {r.due_date && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Due {dateShort(r.due_date)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-muted-foreground">{r.question}</p>
                {r.submitted_to && (
                  <p className="mt-1 text-xs text-muted-foreground">To: {r.submitted_to}</p>
                )}
                {r.response ? (
                  <p className="mt-2 rounded-lg bg-secondary/60 p-2 text-sm">
                    <span className="font-semibold">Response: </span>
                    {r.response}
                  </p>
                ) : (
                  r.status !== "closed" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className={`${inputCls} flex-1`}
                        placeholder="Type a response…"
                        value={responding[r.id] ?? ""}
                        onChange={(e) => setResponding({ ...responding, [r.id]: e.target.value })}
                      />
                      <button
                        className="btn-outline text-sm"
                        onClick={async () => {
                          const text = (responding[r.id] ?? "").trim();
                          if (!text) return;
                          await respondToRfi(r.id, text);
                          setResponding({ ...responding, [r.id]: "" });
                          rfis.refetch();
                        }}
                      >
                        Respond
                      </button>
                    </div>
                  )
                )}
                {r.status !== "closed" && (
                  <button
                    className="mt-2 text-xs text-muted-foreground underline underline-offset-2"
                    onClick={async () => {
                      await setRfiStatus(r.id, "closed");
                      rfis.refetch();
                    }}
                  >
                    Close
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Submit a new RFI</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Subject" required>
              <input
                required
                className={inputCls}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <Field label="Submitted to" hint="Optional — e.g. Architect, Structural engineer">
              <input
                className={inputCls}
                value={form.submittedTo}
                onChange={(e) => setForm({ ...form, submittedTo: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Question" required>
            <textarea
              required
              rows={2}
              className={inputCls}
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </Field>
          <Field label="Due date" hint="Optional">
            <input
              type="date"
              className={inputCls}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </Field>
          <button className="btn-accent w-fit disabled:opacity-60" disabled={saving}>
            {saving ? "Sending…" : "Submit RFI"}
          </button>
        </form>
      </Section>
    </div>
  );
}
