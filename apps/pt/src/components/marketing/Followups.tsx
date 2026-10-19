import { useEffect, useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { getErrorMessage } from "@/lib/error-message";
import {
  leadFacts,
  logActivity,
  runAi,
  saveFollowup,
  sendFollowupEmail,
  splitDraft,
  updateLead,
  type Followup,
  type Lead,
  type MarketingData,
} from "@/lib/marketing";
import { Field, inputCls, type Focus, type Go } from "./shared";

type Channel = Followup["channel"];

// Everything that needs a next touch: overdue first, then this week, then
// later. Corvus AI writes personalized messages and proposes timed sequences;
// a sequence is only saved once you approve it.
export function Followups({
  data,
  focus,
  go,
  reload,
}: {
  data: MarketingData;
  focus: Focus;
  go: Go;
  reload: () => Promise<void>;
}) {
  const now = new Date();
  const [editing, setEditing] = useState<Followup | "new" | null>(null);
  const [sequenceFor, setSequenceFor] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<string | null>(focus.leadId ?? null);
  useEffect(() => {
    if (focus.leadId) setLeadFilter(focus.leadId);
  }, [focus]);
  const leadById = useMemo(() => new Map(data.leads.map((l) => [l.id, l])), [data.leads]);
  const pending = data.followups.filter(
    (f) => f.status === "pending" && (!leadFilter || f.leadId === leadFilter),
  );
  const weekEnd = new Date(now.getTime() + 7 * 864e5);
  const groups: { title: string; items: Followup[]; tone?: string }[] = [
    {
      title: "Overdue",
      items: pending.filter((f) => new Date(f.dueAt) < now),
      tone: "text-rose-700",
    },
    {
      title: "Due this week",
      items: pending.filter((f) => new Date(f.dueAt) >= now && new Date(f.dueAt) <= weekEnd),
    },
    { title: "Scheduled later", items: pending.filter((f) => new Date(f.dueAt) > weekEnd) },
  ];
  const done = data.followups
    .filter((f) => f.status !== "pending" && (!leadFilter || f.leadId === leadFilter))
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 10);
  const filtered = leadFilter ? leadById.get(leadFilter) : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {filtered ? (
            <>
              Showing follow-ups for{" "}
              <strong className="text-foreground">{filtered.fullName || filtered.email}</strong>{" "}
              <button
                type="button"
                onClick={() => setLeadFilter(null)}
                className="text-accent hover:underline"
              >
                Show all
              </button>
            </>
          ) : (
            `${pending.length} pending · ${groups[0].items.length} overdue`
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {filtered && (
            <button
              type="button"
              onClick={() => setSequenceFor(filtered.id)}
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
            >
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI follow-up sequence
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden /> New follow-up
          </button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.title} className="card-elev p-4">
          <h2 className={`text-sm font-semibold ${g.tone ?? ""}`}>
            {g.title} ({g.items.length})
          </h2>
          {g.items.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {g.items.map((f) => (
                <FollowupRow
                  key={f.id}
                  f={f}
                  lead={leadById.get(f.leadId)}
                  data={data}
                  go={go}
                  reload={reload}
                  onEdit={() => setEditing(f)}
                  onSequence={() => setSequenceFor(f.leadId)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {done.length > 0 && (
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Recently completed</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {done.map((f) => (
              <li key={f.id} className="flex justify-between gap-2 text-muted-foreground">
                <span className="truncate">
                  {leadById.get(f.leadId)?.fullName ?? "Lead"} · {f.channel} · {f.subject ?? ""}
                </span>
                <span className="shrink-0 capitalize">{f.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <FollowupEditor
          followup={editing === "new" ? null : editing}
          defaultLeadId={leadFilter}
          data={data}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
      {sequenceFor && leadById.get(sequenceFor) && (
        <SequenceBuilder
          lead={leadById.get(sequenceFor)!}
          data={data}
          reload={reload}
          onClose={() => setSequenceFor(null)}
        />
      )}
    </div>
  );
}

function FollowupRow({
  f,
  lead,
  data,
  go,
  reload,
  onEdit,
  onSequence,
}: {
  f: Followup;
  lead: Lead | undefined;
  data: MarketingData;
  go: Go;
  reload: () => Promise<void>;
  onEdit: () => void;
  onSequence: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const late = new Date(f.dueAt) < new Date();
  async function step(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    try {
      await fn();
      await reload();
      toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }
  const complete = (status: "done" | "skipped") =>
    step(
      status,
      async () => {
        await saveFollowup(f.id, { status });
        if (status === "done" && lead) {
          await logActivity({
            leadId: lead.id,
            kind: f.channel === "call" ? "call" : "follow_up",
            summary: `Follow-up done (${f.channel})${f.subject ? `: ${f.subject}` : ""}`,
            body: f.message,
          });
          await updateLead(lead.id, {
            lastContactedAt: new Date().toISOString(),
            ...(lead.stage === "new" ? { stage: "contacted" } : {}),
          });
        }
      },
      status === "done" ? "Marked done." : "Skipped.",
    );

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => lead && go("leads", { leadId: lead.id })}
            className="text-sm font-medium hover:underline"
          >
            {lead?.fullName || lead?.email || "Lead"}
          </button>
          <div className="text-xs text-muted-foreground">
            <span className="capitalize">{f.channel}</span> · due{" "}
            {new Date(f.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {late && <span className="ml-1 font-semibold text-rose-700">overdue</span>}
            {f.sequenceName && ` · ${f.sequenceName} step ${f.sequenceStep}`}
            {lead?.unsubscribedAt && f.channel === "email" && (
              <span className="ml-1 font-semibold text-rose-700">· unsubscribed</span>
            )}
          </div>
          {f.subject && <div className="mt-1 text-sm">{f.subject}</div>}
          {f.message ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {f.message}
            </p>
          ) : (
            <p className="mt-1 text-xs italic text-muted-foreground">No message yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!!busy || !lead}
            onClick={() =>
              void step(
                "ai",
                async () => {
                  const r = await runAi({
                    scope: "followup",
                    leadId: lead!.id,
                    instruction:
                      `Write a short, personal ${f.channel === "call" ? "call script (3-4 lines)" : f.channel === "sms" ? "SMS (under 300 characters)" : "follow-up email"} for this lead. ` +
                      (f.channel === "email"
                        ? "Reply as 'Subject: <subject>' then a blank line then the body (under 110 words). "
                        : "") +
                      "Refer to their property or deadline when known, and end with one clear next step. No made-up facts.",
                    context: leadFacts(lead!, data.activities, data.followups),
                  });
                  const d =
                    f.channel === "email"
                      ? splitDraft(r.result ?? "")
                      : { subject: f.subject ?? "", body: r.result ?? "" };
                  await saveFollowup(f.id, {
                    message: d.body,
                    subject: d.subject || f.subject || undefined,
                    aiGenerated: true,
                  });
                },
                "Message written — review it before sending.",
              )
            }
            className="btn-outline text-xs disabled:opacity-60"
          >
            {busy === "ai" ? "Writing…" : f.message ? "Rewrite with AI" : "Write with AI"}
          </button>
          <button type="button" onClick={onEdit} className="btn-outline text-xs">
            Edit
          </button>
          {f.channel === "email" && (
            <button
              type="button"
              disabled={!!busy || !f.message || !!lead?.unsubscribedAt}
              onClick={() => void step("send", () => sendFollowupEmail(f.id), "Email sent.")}
              className="btn-primary btn-primary-hover text-xs disabled:opacity-60"
              title={!f.message ? "Write the message first" : undefined}
            >
              {busy === "send" ? "Sending…" : "Send email"}
            </button>
          )}
          {f.channel !== "email" && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void complete("done")}
              className="btn-primary btn-primary-hover text-xs"
            >
              Done
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void complete("skipped")}
            className="text-xs text-muted-foreground hover:underline"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onSequence}
            className="text-xs text-accent hover:underline"
          >
            Sequence…
          </button>
        </div>
      </div>
    </li>
  );
}

function FollowupEditor({
  followup,
  defaultLeadId,
  data,
  reload,
  onClose,
}: {
  followup: Followup | null;
  defaultLeadId: string | null;
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const local = (iso: string) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  };
  const [leadId, setLeadId] = useState(followup?.leadId ?? defaultLeadId ?? "");
  const [channel, setChannel] = useState<Channel>(followup?.channel ?? "email");
  const [due, setDue] = useState(
    local(followup?.dueAt ?? new Date(Date.now() + 864e5).toISOString()),
  );
  const [subject, setSubject] = useState(followup?.subject ?? "");
  const [message, setMessage] = useState(followup?.message ?? "");
  const [busy, setBusy] = useState(false);
  const leads = [...data.leads]
    .filter((l) => l.stage !== "lost")
    .sort((a, b) => (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? ""));
  return (
    <Modal onClose={onClose} wide>
      <form
        className="grid gap-3 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!leadId) return toast.error("Choose a lead.");
          setBusy(true);
          try {
            await saveFollowup(followup?.id ?? null, {
              leadId,
              channel,
              dueAt: new Date(due).toISOString(),
              subject,
              message,
            });
            await reload();
            toast.success("Follow-up saved.");
            onClose();
          } catch (err) {
            toast.error(getErrorMessage(err, "Could not save."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-xl font-semibold">
          {followup ? "Edit follow-up" : "New follow-up"}
        </h2>
        <Field label="Lead">
          <select
            className={inputCls}
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            disabled={!!followup}
          >
            <option value="">Choose a lead…</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.fullName || l.email}
                {l.company ? ` — ${l.company}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel">
            <select
              className={inputCls}
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
            >
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="task">Task</option>
              <option value="sms" disabled>
                SMS — needs an SMS provider
              </option>
            </select>
          </Field>
          <Field label="Due">
            <input
              className={inputCls}
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Subject">
          <input
            className={inputCls}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label="Message">
          <textarea
            className={inputCls}
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Step = { day: number; channel: Channel; subject: string; message: string };

function parseSequence(text: string): Step[] {
  // Expected blocks: "STEP | day N | channel | subject" then the message lines.
  const steps: Step[] = [];
  const blocks = text.split(/\n(?=\s*\**\s*step\b)/i);
  for (const b of blocks) {
    const head = b.match(
      /step[^|\n]*\|\s*day\s*(\d+)\s*\|\s*(email|call|task|sms)\s*\|\s*([^\n]*)/i,
    );
    if (!head) continue;
    const message = b
      .slice(b.indexOf(head[0]) + head[0].length)
      .replace(/\*\*/g, "")
      .trim();
    steps.push({
      day: Number(head[1]),
      channel: head[2].toLowerCase() as Channel,
      subject: head[3].replace(/\*\*/g, "").trim(),
      message,
    });
  }
  return steps.filter((s) => s.channel !== "sms").slice(0, 5);
}

function SequenceBuilder({
  lead,
  data,
  reload,
  onClose,
}: {
  lead: Lead;
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function generate() {
    setBusy(true);
    try {
      const r = await runAi({
        scope: "sequence",
        leadId: lead.id,
        instruction:
          "Plan a 3-step follow-up sequence to move this lead to the next stage. Pick the timing (days from today) and channel for each step based on their stage, deadline and history " +
          "(channels: email, call, task — no SMS). For each step write exactly one header line 'STEP | day N | channel | subject', then the message (emails under 100 words, call scripts 3 lines). No made-up facts.",
        context: leadFacts(lead, data.activities, data.followups),
      });
      const parsed = parseSequence(r.result ?? "");
      if (!parsed.length) throw new Error("Corvus AI's plan couldn't be read — try again.");
      setSteps(parsed);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not plan a sequence."));
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!steps) return;
    setBusy(true);
    try {
      const name = `AI sequence ${new Date().toLocaleDateString()}`;
      for (const [i, s] of steps.entries()) {
        const due = new Date();
        due.setDate(due.getDate() + s.day);
        due.setHours(10, 0, 0, 0);
        await saveFollowup(null, {
          leadId: lead.id,
          channel: s.channel,
          dueAt: due.toISOString(),
          subject: s.subject,
          message: s.message,
          sequenceName: name,
          sequenceStep: i + 1,
          aiGenerated: true,
        });
      }
      await logActivity({
        leadId: lead.id,
        kind: "ai",
        summary: `Approved a ${steps.length}-step follow-up sequence`,
      });
      await reload();
      toast.success(`${steps.length} follow-ups scheduled.`);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save the sequence."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose} wide>
      <div className="grid gap-4 p-6">
        <h2 className="font-serif text-xl font-semibold">
          Follow-up sequence — {lead.fullName || lead.email}
        </h2>
        <p className="text-sm text-muted-foreground">
          Corvus AI plans the timing and writes each message. Nothing is scheduled until you
          approve; you can edit any step afterwards.
        </p>
        {!steps ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="btn-primary btn-primary-hover justify-self-start text-sm disabled:opacity-60"
          >
            {busy ? "Planning…" : "Plan the sequence"}
          </button>
        ) : (
          <>
            <ol className="grid gap-3">
              {steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Step {i + 1} · day {s.day} · <span className="capitalize">{s.channel}</span>
                  </div>
                  <input
                    className={`${inputCls} mt-1`}
                    value={s.subject}
                    onChange={(e) =>
                      setSteps((p) =>
                        p!.map((x, k) => (k === i ? { ...x, subject: e.target.value } : x)),
                      )
                    }
                    aria-label={`Step ${i + 1} subject`}
                  />
                  <textarea
                    className={`${inputCls} mt-1`}
                    rows={4}
                    value={s.message}
                    onChange={(e) =>
                      setSteps((p) =>
                        p!.map((x, k) => (k === i ? { ...x, message: e.target.value } : x)),
                      )
                    }
                    aria-label={`Step ${i + 1} message`}
                  />
                </li>
              ))}
            </ol>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void generate()}
                className="btn-outline text-sm"
              >
                Re-plan
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve()}
                className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
              >
                {busy ? "Saving…" : "Approve sequence"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
