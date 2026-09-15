import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2 } from "lucide-react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { updatePermit } from "@/lib/projects";
import {
  listReviewComments,
  addReviewComment,
  setReviewCommentStatus,
} from "@/lib/project-activity";
import {
  Section,
  Pill,
  EmptyProject,
  Loading,
  humanize,
  permitStatusTone,
  Field,
  inputCls,
} from "@/components/dp-ui";
import { dateShort } from "@/lib/format";
import { translateReviewComment } from "@/lib/ai";

export const Route = createFileRoute("/dashboard/_layout/reviews")({
  head: () => ({ meta: [{ title: "Reviews — CorvusDP" }] }),
  component: Reviews,
});

const PRIORITY_TONE: Record<string, "gray" | "amber" | "red" | "blue"> = {
  low: "gray",
  medium: "blue",
  high: "amber",
  critical: "red",
};

function Reviews() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();
  const projectId = project?.id;
  const comments = useQuery({
    queryKey: ["review-comments", projectId],
    queryFn: () => listReviewComments(projectId!),
    enabled: !!projectId,
  });

  const [form, setForm] = useState({
    original: "",
    plain: "",
    why: "",
    action: "",
    responsible: "",
    priority: "medium",
  });
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const permits = bundle?.permits ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !form.original.trim()) return;
    setSaving(true);
    await addReviewComment({
      projectId,
      original: form.original,
      plainLanguage: form.plain || undefined,
      whyItMatters: form.why || undefined,
      requiredAction: form.action || undefined,
      responsible: form.responsible || undefined,
      priority: form.priority,
    });
    setForm({ original: "", plain: "", why: "", action: "", responsible: "", priority: "medium" });
    setSaving(false);
    comments.refetch();
  }

  async function autoFillWithAi() {
    if (!form.original.trim()) return;
    setTranslating(true);
    setTranslateErr(null);
    try {
      const t = await translateReviewComment({
        comment: form.original,
        permitName: permits[0]?.name,
      });
      setForm((f) => ({
        ...f,
        plain: t.plainLanguage,
        why: t.whyItMatters,
        action: t.requiredAction,
        responsible: t.responsible,
        priority: t.priority,
      }));
    } catch (e) {
      setTranslateErr(e instanceof Error ? e.message : "Couldn't translate that comment.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Submission & review status"
        subtitle="Where each submitted permit stands with its reviewer, and when to expect an update."
      >
        <div className="grid gap-2">
          {permits.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-2">
                  <Pill tone={permitStatusTone(p.status)}>{humanize(p.status)}</Pill>
                  {p.review_round > 0 && (
                    <span className="text-xs text-muted-foreground">
                      round {p.review_round + 1}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <label className="flex items-center gap-1">
                  Current reviewer:
                  <input
                    defaultValue={p.current_reviewer ?? ""}
                    placeholder="add"
                    onBlur={async (e) => {
                      if (e.target.value !== (p.current_reviewer ?? "")) {
                        await updatePermit(p.id, { current_reviewer: e.target.value });
                        refetch();
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-input bg-background px-1"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Est. next update:
                  <input
                    type="date"
                    defaultValue={p.est_next_update ?? ""}
                    onBlur={async (e) => {
                      if (e.target.value !== (p.est_next_update ?? "")) {
                        await updatePermit(p.id, { est_next_update: e.target.value || null });
                        refetch();
                      }
                    }}
                    className="rounded border border-input bg-background px-1"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Review comments"
        subtitle="Plain-English translations of each reviewer comment, with an owner and resolution status. For informal calls/emails with the jurisdiction, log those under City instead."
      >
        {comments.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (comments.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No review comments logged yet.</p>
        ) : (
          <ul className="grid gap-3">
            {(comments.data ?? []).map((c, i) => (
              <li
                key={c.id}
                className="list-item-enter rounded-lg border border-border p-4 text-sm"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex items-center gap-2">
                  <Pill tone={PRIORITY_TONE[c.priority] ?? "gray"}>{c.priority}</Pill>
                  <Pill
                    tone={c.status === "closed" || c.status === "addressed" ? "green" : "amber"}
                  >
                    {humanize(c.status)}
                  </Pill>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {dateShort(c.created_at)}
                  </span>
                </div>
                <p className="mt-2 font-medium">{c.original}</p>
                {c.plain_language && (
                  <p className="mt-1 text-muted-foreground">Plain language: {c.plain_language}</p>
                )}
                {c.why_it_matters && (
                  <p className="mt-1 text-muted-foreground">Why it matters: {c.why_it_matters}</p>
                )}
                {c.required_action && <p className="mt-1">Action: {c.required_action}</p>}
                <div className="mt-2 flex items-center gap-3 text-xs">
                  {c.responsible && (
                    <span className="text-muted-foreground">Owner: {c.responsible}</span>
                  )}
                  {c.status !== "closed" && (
                    <button
                      className="text-accent underline underline-offset-2"
                      onClick={async () => {
                        await setReviewCommentStatus(
                          c.id,
                          c.status === "open"
                            ? "in_progress"
                            : c.status === "in_progress"
                              ? "addressed"
                              : "closed",
                        );
                        comments.refetch();
                      }}
                    >
                      Advance status
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Log a review comment</div>
          <Field label="Original comment (from the city)" required>
            <textarea
              required
              rows={2}
              className={inputCls}
              value={form.original}
              onChange={(e) => setForm({ ...form, original: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-outline w-fit text-xs disabled:opacity-50"
              disabled={!form.original.trim() || translating}
              onClick={autoFillWithAi}
            >
              {translating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Auto-fill with AI
            </button>
            {translateErr && <span className="text-xs text-destructive">{translateErr}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plain-language explanation">
              <input
                className={inputCls}
                value={form.plain}
                onChange={(e) => setForm({ ...form, plain: e.target.value })}
              />
            </Field>
            <Field label="Why it matters">
              <input
                className={inputCls}
                value={form.why}
                onChange={(e) => setForm({ ...form, why: e.target.value })}
              />
            </Field>
            <Field label="Required action">
              <input
                className={inputCls}
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
              />
            </Field>
            <Field label="Responsible consultant">
              <input
                className={inputCls}
                value={form.responsible}
                onChange={(e) => setForm({ ...form, responsible: e.target.value })}
              />
            </Field>
            <Field label="Priority">
              <select
                className={inputCls}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {["low", "medium", "high", "critical"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
          </div>
          <button className="btn-accent w-fit disabled:opacity-60" disabled={saving}>
            {saving ? "Saving…" : "Add comment"}
          </button>
        </form>
      </Section>
    </div>
  );
}
