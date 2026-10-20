import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import {
  OBJECTIVE_LABEL,
  TEMPLATE_OBJECTIVES,
  createLead,
  isDnc,
  leadFacts,
  loadAppointments,
  type MarketingAppointment,
  logActivity,
  markTemplateUsed,
  money,
  pct,
  relDays,
  runAi,
  runRules,
  saveFollowup,
  sendFollowupEmail,
  splitDraft,
  updateLead,
  type AiRun,
  type Followup,
  type Lead,
  type MarketingData,
  type Outcome,
  type TemplateObjective,
} from "@/lib/marketing";
import {
  bestTiming,
  effectiveness,
  followupQueue,
  journeyFunnel,
  journeyLinks,
  leadName,
  personalize,
  pickTemplate,
  rankAll,
  shownPriority,
  type QueueItem,
} from "@/lib/marketing-crm";
import {
  AiBox,
  Field,
  PriorityBadge,
  StageBadge,
  StatTile,
  inputCls,
  type Focus,
  type Go,
} from "./shared";

type Channel = Followup["channel"];
type View = "queue" | "tasks" | "journey" | "signups" | "performance";
const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  sms: "Text",
  call: "Call",
  meeting: "Meeting",
  task: "Task",
};
const SITE = () => `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, "");
const localInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

type Draft = {
  id: string | null;
  leadId: string;
  channel: Channel;
  dueAt: Date;
  subject: string;
  message: string;
  callScript: string;
  assignedTo: string | null;
  priority: "high" | "medium" | "low";
  objective: TemplateObjective | null;
  templateId: string | null;
  autoSend: boolean;
  autoReschedule: boolean;
  aiGenerated: boolean;
  status: Followup["status"];
};

// Follow-ups: what Corvus AI says needs doing, the team's tasks, the
// registration → subscription journey, and how well follow-ups are working.
export function Followups({
  data,
  focus,
  go,
  reload,
  onAiRun,
}: {
  data: MarketingData;
  focus: Focus;
  go: Go;
  reload: () => Promise<void>;
  onAiRun?: (r: AiRun) => void;
}) {
  const [view, setView] = useState<View>(focus.leadId ? "tasks" : "queue");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sequenceFor, setSequenceFor] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<string | null>(focus.leadId ?? null);
  useEffect(() => {
    if (focus.leadId) {
      setLeadFilter(focus.leadId);
      setView("tasks");
    }
  }, [focus]);
  const ranks = useMemo(() => rankAll(data), [data]);
  const priorityOf = (l: Lead) => (ranks.get(l.id) ? shownPriority(l, ranks.get(l.id)!) : "medium");
  const leadById = useMemo(() => new Map(data.leads.map((l) => [l.id, l])), [data.leads]);
  const queue = useMemo(() => followupQueue(data, ranks), [data, ranks]);
  const open = data.followups.filter((f) => f.status === "pending" || f.status === "draft");
  const overdue = open.filter(
    (f) => f.status === "pending" && new Date(f.dueAt) < new Date(),
  ).length;
  const drafts = open.filter((f) => f.status === "draft").length;

  /** A follow-up prepared from a template for this lead (and objective). */
  const prepare = (
    l: Lead,
    opts: { channel?: Channel; objective?: TemplateObjective; at?: Date } = {},
  ): Draft => {
    const prio = priorityOf(l);
    const t = bestTiming(l, data.activities, prio);
    const channel = opts.channel ?? t.channel;
    const tplChannel = channel === "sms" ? "sms" : "email";
    const pick = pickTemplate(l, data.templates, data.activities, tplChannel, opts.objective);
    const tpl = channel === "email" || channel === "sms" ? pick.template : null;
    const links = journeyLinks(l, SITE());
    const fill = (s: string) =>
      personalize(s, l)
        .replaceAll("{{registration_link}}", links.registration)
        .replaceAll("{{add_property_link}}", links.addProperty)
        .replaceAll("{{checkout_link}}", links.checkout);
    return {
      id: null,
      leadId: l.id,
      channel,
      dueAt: opts.at ?? t.at,
      subject: tpl?.subject
        ? fill(tpl.subject)
        : `${OBJECTIVE_LABEL[pick.objective]}: ${leadName(l)}`,
      message: tpl ? fill(tpl.body) : "",
      callScript: "",
      assignedTo: l.assignedTo ?? data.me,
      priority: prio,
      objective: pick.objective,
      templateId: tpl?.id ?? null,
      autoSend: false,
      autoReschedule: true,
      aiGenerated: false,
      status: "draft",
    };
  };
  const edit = (f: Followup): Draft => ({
    id: f.id,
    leadId: f.leadId,
    channel: f.channel,
    dueAt: new Date(f.dueAt),
    subject: f.subject ?? "",
    message: f.message ?? "",
    callScript: f.callScript ?? "",
    assignedTo: f.assignedTo,
    priority: f.priority,
    objective: null,
    templateId: f.templateId,
    autoSend: f.autoSend,
    autoReschedule: f.autoReschedule,
    aiGenerated: f.aiGenerated,
    status: f.status,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-md border border-border p-0.5 text-sm"
          role="tablist"
          aria-label="Follow-ups view"
        >
          {(
            [
              ["queue", `AI queue (${queue.length})`],
              ["tasks", `Tasks (${open.length})`],
              ["journey", "Journey"],
              ["signups", "Sign-ups & meetings"],
              ["performance", "Performance"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded px-3 py-1 ${view === k ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {(overdue > 0 || drafts > 0) && (
          <span className="text-xs text-muted-foreground">
            {overdue > 0 && <b className="text-rose-700">{overdue} overdue</b>}
            {overdue > 0 && drafts > 0 && " · "}
            {drafts > 0 && <b className="text-amber-800">{drafts} waiting for approval</b>}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            const l = (leadFilter && leadById.get(leadFilter)) || data.leads.find((x) => !isDnc(x));
            if (l) setDraft({ ...prepare(l), channel: "call", message: "" });
          }}
          className="btn-primary btn-primary-hover ml-auto inline-flex items-center gap-1.5 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden /> New follow-up
        </button>
      </div>

      {view === "queue" && (
        <Queue
          data={data}
          queue={queue}
          prepare={prepare}
          setDraft={setDraft}
          reload={reload}
          go={go}
        />
      )}
      {view === "tasks" && (
        <Tasks
          data={data}
          leadFilter={leadFilter}
          setLeadFilter={setLeadFilter}
          leadById={leadById}
          onEdit={(f) => setDraft(edit(f))}
          onSequence={(id) => setSequenceFor(id)}
          reload={reload}
          go={go}
        />
      )}
      {view === "journey" && (
        <Journey
          data={data}
          priorityOf={priorityOf}
          prepare={prepare}
          setDraft={setDraft}
          go={go}
        />
      )}
      {view === "signups" && (
        <Signups data={data} prepare={prepare} setDraft={setDraft} reload={reload} go={go} />
      )}
      {view === "performance" && <Performance data={data} onAiRun={onAiRun} />}

      {draft && (
        <Composer draft={draft} data={data} reload={reload} onClose={() => setDraft(null)} />
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

// ── AI queue ────────────────────────────────────────────────────────────────
const KIND_LABEL: Record<QueueItem["kind"], string> = {
  checkout: "Abandoned checkout",
  subscribe: "Property added, not subscribed",
  interested: "Interested, not registered",
  registration: "Registration not finished",
  property: "No property yet",
  more_properties: "More properties to add",
  no_response: "No response",
  quiet: "Never contacted",
};
function Queue({
  data,
  queue,
  prepare,
  setDraft,
  reload,
  go,
}: {
  data: MarketingData;
  queue: QueueItem[];
  prepare: (l: Lead, o?: { channel?: Channel; objective?: TemplateObjective; at?: Date }) => Draft;
  setDraft: (d: Draft) => void;
  reload: () => Promise<void>;
  go: Go;
}) {
  const [busy, setBusy] = useState(false);
  async function draftTop(n: number) {
    setBusy(true);
    try {
      let made = 0;
      for (const q of queue.slice(0, n)) {
        if (isDnc(q.lead)) continue;
        const d = prepare(q.lead, { objective: q.objective });
        if (
          (d.channel === "email" && (!q.lead.email || q.lead.unsubscribedAt)) ||
          (d.channel === "sms" && !q.lead.phone)
        )
          continue;
        await saveFollowup(null, {
          leadId: d.leadId,
          channel: d.channel,
          dueAt: d.dueAt.toISOString(),
          subject: d.subject,
          message: d.message || null,
          assignedTo: d.assignedTo,
          priority: d.priority,
          templateId: d.templateId,
          status: "draft",
          aiGenerated: true,
        });
        made++;
      }
      await reload();
      toast.success(
        `${made} follow-up${made === 1 ? "" : "s"} drafted — review and approve them in Tasks.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't draft those."));
    } finally {
      setBusy(false);
    }
  }
  if (!queue.length)
    return (
      <p className="card-elev p-6 text-sm text-muted-foreground">
        Nobody needs a follow-up right now — every open prospect has one planned.
      </p>
    );
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Needs a follow-up — highest conversion potential first
          </h2>
          <p className="text-xs text-muted-foreground">
            Corvus AI watches every lead: no reply, interested but not registered, unfinished
            registration, no property, no subscription, abandoned checkout.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void draftTop(10)}
          className="btn-outline inline-flex items-center gap-1.5 text-xs"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
          {busy ? "Drafting…" : "Draft the top 10 for approval"}
        </button>
      </div>
      <ul className="mt-3 grid gap-2">
        {queue.slice(0, 60).map((q) => (
          <li
            key={q.lead.id}
            className="grid gap-2 rounded-md border border-border p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <PriorityBadge priority={q.priority} />
                <button
                  type="button"
                  onClick={() => go("leads", { leadId: q.lead.id })}
                  className="truncate font-medium hover:underline"
                >
                  {leadName(q.lead)}
                </button>
                <StageBadge stage={q.lead.stage} />
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">
                  {KIND_LABEL[q.kind]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {q.reason}
                {q.lead.portfolioValue ? ` · ${money(q.lead.portfolioValue)}` : ""}
              </p>
              <p className="text-xs">
                Next: <b>{CHANNEL_LABEL[q.timing.channel]}</b>{" "}
                {q.timing.at.toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · {OBJECTIVE_LABEL[q.objective]}
                <span className="text-muted-foreground"> — {q.timing.why}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft(prepare(q.lead, { objective: q.objective }))}
              className="btn-primary btn-primary-hover justify-self-start text-xs md:justify-self-end"
            >
              Prepare
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Tasks ───────────────────────────────────────────────────────────────────
const CALL_OUTCOMES: { value: string; label: string; outcome: Outcome | null }[] = [
  { value: "interested", label: "Interested", outcome: "interested" },
  { value: "replied", label: "Talked / replied", outcome: "replied" },
  { value: "no_answer", label: "No answer", outcome: "no_answer" },
  { value: "voicemail", label: "Left voicemail", outcome: "no_answer" },
  { value: "not_interested", label: "Not interested", outcome: "not_interested" },
  { value: "do_not_contact", label: "Asked not to be contacted", outcome: "do_not_contact" },
  { value: "done", label: "Done (no outcome)", outcome: null },
];
function Tasks({
  data,
  leadFilter,
  setLeadFilter,
  leadById,
  onEdit,
  onSequence,
  reload,
  go,
}: {
  data: MarketingData;
  leadFilter: string | null;
  setLeadFilter: (id: string | null) => void;
  leadById: Map<string, Lead>;
  onEdit: (f: Followup) => void;
  onSequence: (leadId: string) => void;
  reload: () => Promise<void>;
  go: Go;
}) {
  const [who, setWho] = useState<string>("all");
  const [status, setStatus] = useState<"open" | "draft" | "done">("open");
  const [channel, setChannel] = useState<string>("");
  const [prio, setPrio] = useState<string>("");
  const now = new Date();
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const list = data.followups.filter((f) => {
    if (leadFilter && f.leadId !== leadFilter) return false;
    const owner = f.assignedTo ?? leadById.get(f.leadId)?.assignedTo ?? null;
    if (who === "me" && owner !== data.me) return false;
    if (who === "none" && owner) return false;
    if (!["all", "me", "none"].includes(who) && owner !== who) return false;
    if (channel && f.channel !== channel) return false;
    if (prio && f.priority !== prio) return false;
    if (status === "open") return f.status === "pending" || f.status === "draft";
    if (status === "draft") return f.status === "draft";
    return f.status === "done" || f.status === "skipped";
  });
  const groups =
    status === "done"
      ? [
          {
            title: "Done & stopped",
            items: [...list]
              .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
              .slice(0, 80),
          },
        ]
      : [
          {
            title: "Needs approval",
            items: list.filter((f) => f.status === "draft"),
            tone: "text-amber-800",
          },
          {
            title: "Overdue",
            items: list.filter((f) => f.status === "pending" && new Date(f.dueAt) < now),
            tone: "text-rose-700",
          },
          {
            title: "Today",
            items: list.filter(
              (f) =>
                f.status === "pending" && new Date(f.dueAt) >= now && new Date(f.dueAt) <= endToday,
            ),
          },
          {
            title: "Upcoming",
            items: list.filter((f) => f.status === "pending" && new Date(f.dueAt) > endToday),
          },
        ];
  const staffName = (id: string | null) =>
    data.staff.find((s) => s.id === id)?.name ?? "Unassigned";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          className={sel}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label="Assigned to"
        >
          <option value="all">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {data.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={sel}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Status"
        >
          <option value="open">Open</option>
          <option value="draft">Waiting for approval</option>
          <option value="done">Done & stopped</option>
        </select>
        <select
          className={sel}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          aria-label="Channel"
        >
          <option value="">All channels</option>
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          className={sel}
          value={prio}
          onChange={(e) => setPrio(e.target.value)}
          aria-label="Priority"
        >
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {leadFilter && (
          <button
            type="button"
            onClick={() => setLeadFilter(null)}
            className="rounded-full bg-secondary px-2.5 py-1 text-xs"
          >
            {leadName(
              leadById.get(leadFilter) ??
                ({ company: null, fullName: null, email: "lead" } as Lead),
            )}{" "}
            ✕
          </button>
        )}
        {leadFilter && (
          <button
            type="button"
            onClick={() => onSequence(leadFilter)}
            className="btn-outline inline-flex items-center gap-1.5 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan a sequence
          </button>
        )}
      </div>
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.title} className="card-elev p-4">
            <h2 className={`text-sm font-semibold ${g.tone ?? ""}`}>
              {g.title} ({g.items.length})
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {g.items.map((f) => (
                <TaskRow
                  key={f.id}
                  f={f}
                  lead={leadById.get(f.leadId)}
                  owner={staffName(f.assignedTo ?? leadById.get(f.leadId)?.assignedTo ?? null)}
                  onEdit={onEdit}
                  reload={reload}
                  go={go}
                />
              ))}
            </ul>
          </section>
        ),
      )}
      {groups.every((g) => !g.items.length) && (
        <p className="card-elev p-6 text-sm text-muted-foreground">
          Nothing here. The AI queue shows who needs a follow-up next.
        </p>
      )}
    </div>
  );
}

function TaskRow({
  f,
  lead,
  owner,
  onEdit,
  reload,
  go,
}: {
  f: Followup;
  lead: Lead | undefined;
  owner: string;
  onEdit: (f: Followup) => void;
  reload: () => Promise<void>;
  go: Go;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const late = f.status === "pending" && new Date(f.dueAt) < new Date();
  const step = async (label: string, fn: () => Promise<unknown>, ok: string) => {
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
  };
  const complete = (value: string) => {
    const o = CALL_OUTCOMES.find((x) => x.value === value);
    return step(
      "done",
      async () => {
        await saveFollowup(f.id, { status: "done", outcome: value });
        if (lead) {
          await logActivity({
            leadId: lead.id,
            kind:
              f.channel === "call"
                ? "call"
                : f.channel === "meeting"
                  ? "meeting"
                  : f.channel === "sms"
                    ? "sms"
                    : f.channel === "email"
                      ? "email"
                      : "follow_up",
            summary: `${CHANNEL_LABEL[f.channel]} done${f.subject ? `: ${f.subject}` : ""}${o && o.value !== "done" ? ` — ${o.label}` : ""}`,
            body: f.message,
            outcome: o?.outcome ?? null,
            templateId: f.templateId,
          });
          if (f.channel !== "task") await saveLeadContact(lead);
          await runRules(lead.id);
        }
      },
      "Marked done.",
    );
  };
  const blocked =
    lead && (isDnc(lead) || (f.channel === "email" && (!lead.email || lead.unsubscribedAt)));
  return (
    <li className="grid gap-2 py-2.5 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={f.priority} />
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {CHANNEL_LABEL[f.channel]}
          </span>
          <button
            type="button"
            onClick={() => lead && go("leads", { leadId: lead.id })}
            className="truncate font-medium hover:underline"
          >
            {lead ? leadName(lead) : "Lead"}
          </button>
          {lead && <StageBadge stage={lead.stage} />}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {f.subject || f.message?.slice(0, 80) || "—"}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          <span className={late ? "font-semibold text-rose-700" : ""}>
            {f.status === "done" || f.status === "skipped"
              ? `${f.status === "done" ? "Done" : "Stopped"} ${relDays(f.completedAt)}${f.outcome && f.outcome !== "done" ? ` · ${f.outcome.replace(/_/g, " ")}` : ""}${f.stopReason ? ` · ${f.stopReason}` : ""}`
              : `${late ? "Overdue · " : ""}${new Date(f.dueAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </span>
          <span>· {owner}</span>
          {f.status === "draft" && (
            <span className="font-semibold text-amber-800">· waiting for approval</span>
          )}
          {f.autoSend && f.status === "pending" && <span>· sends automatically</span>}
          {f.rescheduledCount > 0 && <span>· moved {f.rescheduledCount}×</span>}
          {f.sequenceName && (
            <span>
              · {f.sequenceName} step {f.sequenceStep}
            </span>
          )}
          {f.aiGenerated && <span>· AI</span>}
          {blocked && (
            <span className="font-semibold text-rose-700">
              · can&apos;t contact (opted out / no address)
            </span>
          )}
        </div>
        {f.callScript && (
          <details className="text-xs">
            <summary className="cursor-pointer text-accent">Call script</summary>
            <MarkdownLite text={f.callScript} className="mt-1" />
          </details>
        )}
      </div>
      {(f.status === "pending" || f.status === "draft") && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onEdit(f)} className="btn-outline py-1 text-xs">
            {f.status === "draft" ? "Review" : "Edit"}
          </button>
          {f.status === "draft" && (
            <button
              type="button"
              disabled={!!busy || !!blocked}
              onClick={() =>
                void step(
                  "approve",
                  () => saveFollowup(f.id, { status: "pending" }),
                  "Approved and scheduled.",
                )
              }
              className="btn-primary btn-primary-hover py-1 text-xs disabled:opacity-60"
            >
              Approve
            </button>
          )}
          {f.status === "pending" && f.channel === "email" && (
            <button
              type="button"
              disabled={!!busy || !!blocked || !f.message}
              onClick={() => void step("send", () => sendFollowupEmail(f.id), "Email sent.")}
              className="btn-primary btn-primary-hover py-1 text-xs disabled:opacity-60"
            >
              {busy === "send" ? "Sending…" : "Send now"}
            </button>
          )}
          {f.status === "pending" && f.channel !== "email" && (
            <select
              className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              value={outcome}
              aria-label="Record the outcome"
              onChange={(e) => {
                setOutcome(e.target.value);
                if (e.target.value) void complete(e.target.value);
              }}
            >
              <option value="">{f.channel === "call" ? "Log call outcome…" : "Mark done…"}</option>
              {CALL_OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {f.status === "pending" && (
            <button
              type="button"
              disabled={!!busy}
              title="Move to the next best time for this lead"
              onClick={() =>
                void step(
                  "resched",
                  async () => {
                    const at = lead
                      ? bestTiming(lead, [], f.priority, new Date()).at
                      : new Date(Date.now() + 864e5);
                    await saveFollowup(f.id, { dueAt: at.toISOString() });
                  },
                  "Rescheduled.",
                )
              }
              className="btn-outline py-1 text-xs"
            >
              Reschedule
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void step("skip", () => saveFollowup(f.id, { status: "skipped" }), "Skipped.")
            }
            className="px-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
        </div>
      )}
    </li>
  );
}

async function saveLeadContact(lead: Lead) {
  await updateLead(lead.id, { lastContactedAt: new Date().toISOString() });
}

// ── Composer ────────────────────────────────────────────────────────────────
function Composer({
  draft,
  data,
  reload,
  onClose,
}: {
  draft: Draft;
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState<string | null>(null);
  const lead = data.leads.find((l) => l.id === d.leadId);
  const leads = useMemo(
    () =>
      [...data.leads]
        .filter((l) => !isDnc(l))
        .sort((a, b) => leadName(a).localeCompare(leadName(b))),
    [data.leads],
  );
  const blocked = !lead
    ? "Choose a lead"
    : isDnc(lead)
      ? "Do Not Contact"
      : d.channel === "email" && (!lead.email || lead.unsubscribedAt)
        ? lead.unsubscribedAt
          ? "They unsubscribed from email"
          : "No email address"
        : (d.channel === "sms" || d.channel === "call") && !lead.phone
          ? "No phone number"
          : null;
  const message = d.channel === "email" || d.channel === "sms";
  const talk = d.channel === "call" || d.channel === "meeting";

  async function ai() {
    if (!lead) return;
    setBusy("ai");
    try {
      const props = data.properties.filter((p) => p.leadId === lead.id).slice(0, 5);
      const links = journeyLinks(lead, SITE());
      const r = await runAi({
        scope: "followup",
        leadId: lead.id,
        instruction: message
          ? `Write a personalised follow-up ${d.channel === "sms" ? "text (under 300 characters, end with 'Reply STOP to opt out.')" : "email (under 140 words)"} for where this prospect is now and what's happened so far. ` +
            `${d.objective ? `Goal: ${OBJECTIVE_LABEL[d.objective]}. ` : ""}If they need to finish a step, include the right link: registration ${links.registration}, add properties ${links.addProperty}, finish checkout ${links.checkout}. ` +
            (d.channel === "sms"
              ? "Reply with the text only."
              : "Reply exactly as 'Subject: <subject>' on the first line, a blank line, then the body.")
          : `Write a short ${d.channel === "call" ? "call script" : "meeting agenda"} in markdown for this prospect: opener, 2-3 questions tailored to their properties and history, the ask (the next step for where they are), and how to handle "not now". Bullets.`,
        context:
          leadFacts(lead, data.activities, data.followups) +
          `\nProperties: ${props.map((p) => `${p.address} (${money(p.assessedValue)}${p.changePct != null ? `, ${p.changePct}% on last year` : ""})`).join("; ") || "none"}` +
          (d.message ? `\nCurrent draft:\n${d.subject}\n${d.message}` : ""),
      });
      const out = r.result ?? "";
      if (talk) setD((x) => ({ ...x, callScript: out, aiGenerated: true }));
      else if (d.channel === "sms") setD((x) => ({ ...x, message: out.trim(), aiGenerated: true }));
      else {
        const sp = splitDraft(out);
        setD((x) => ({
          ...x,
          subject: sp.subject || x.subject,
          message: sp.body || x.message,
          aiGenerated: true,
        }));
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't write that."));
    } finally {
      setBusy(null);
    }
  }

  async function save(status: "draft" | "pending") {
    if (!lead) return toast.error("Choose a lead.");
    if (status === "pending" && blocked) return toast.error(`Can't schedule: ${blocked}.`);
    if (message && !d.message.trim()) return toast.error("Write the message first.");
    setBusy(status);
    try {
      await saveFollowup(d.id, {
        leadId: d.leadId,
        channel: d.channel,
        dueAt: d.dueAt.toISOString(),
        subject: d.subject.trim() || null,
        message: d.message.trim() || null,
        callScript: d.callScript.trim() || null,
        assignedTo: d.assignedTo,
        priority: d.priority,
        templateId: d.templateId,
        autoSend: d.channel === "email" && d.autoSend,
        autoReschedule: d.autoReschedule,
        aiGenerated: d.aiGenerated,
        status,
      });
      const t = data.templates.find((x) => x.id === d.templateId);
      if (status === "pending" && t && !d.id) await markTemplateUsed(t);
      await reload();
      toast.success(
        status === "draft"
          ? "Saved for approval."
          : d.autoSend && d.channel === "email"
            ? "Approved — it sends by itself when due."
            : "Approved and scheduled.",
      );
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save it."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="grid gap-3 p-6">
        <h2 className="font-serif text-xl font-semibold">
          {d.id ? (d.status === "draft" ? "Review follow-up" : "Edit follow-up") : "New follow-up"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lead">
            <select
              className={inputCls}
              value={d.leadId}
              onChange={(e) => setD({ ...d, leadId: e.target.value })}
            >
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {leadName(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              className={inputCls}
              value={d.channel}
              onChange={(e) => setD({ ...d, channel: e.target.value as Channel })}
            >
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned to">
            <select
              className={inputCls}
              value={d.assignedTo ?? ""}
              onChange={(e) => setD({ ...d, assignedTo: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className={inputCls}
              value={d.priority}
              onChange={(e) => setD({ ...d, priority: e.target.value as Draft["priority"] })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Due">
            <span className="flex gap-1.5">
              <input
                type="datetime-local"
                className={inputCls}
                value={localInput(d.dueAt)}
                onChange={(e) => e.target.value && setD({ ...d, dueAt: new Date(e.target.value) })}
              />
              {lead && (
                <button
                  type="button"
                  className="btn-outline whitespace-nowrap px-2 text-xs"
                  title={bestTiming(lead, data.activities, d.priority).why}
                  onClick={() => {
                    const t = bestTiming(lead, data.activities, d.priority);
                    setD({ ...d, dueAt: t.at });
                    toast.info(t.why);
                  }}
                >
                  Best time
                </button>
              )}
            </span>
          </Field>
          {message && (
            <Field label="Template">
              <select
                className={inputCls}
                value={d.templateId ?? ""}
                onChange={(e) => {
                  const t = data.templates.find((x) => x.id === e.target.value);
                  if (!t || !lead) return setD({ ...d, templateId: null });
                  const links = journeyLinks(lead, SITE());
                  const fill = (s: string) =>
                    personalize(s, lead)
                      .replaceAll("{{registration_link}}", links.registration)
                      .replaceAll("{{add_property_link}}", links.addProperty)
                      .replaceAll("{{checkout_link}}", links.checkout);
                  setD({
                    ...d,
                    templateId: t.id,
                    subject: t.subject ? fill(t.subject) : d.subject,
                    message: fill(t.body),
                  });
                }}
              >
                <option value="">— none —</option>
                {TEMPLATE_OBJECTIVES.map((o) => {
                  const items = data.templates.filter(
                    (t) =>
                      t.active &&
                      t.objective === o &&
                      t.channel === (d.channel === "sms" ? "sms" : "email"),
                  );
                  return items.length ? (
                    <optgroup key={o} label={OBJECTIVE_LABEL[o]}>
                      {items.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </Field>
          )}
        </div>
        {d.channel !== "sms" && (
          <Field label={d.channel === "email" ? "Subject" : "What it's about"}>
            <input
              className={inputCls}
              value={d.subject}
              onChange={(e) => setD({ ...d, subject: e.target.value })}
            />
          </Field>
        )}
        {(message || d.channel === "task") && (
          <Field label={d.channel === "task" ? "Notes" : "Message"}>
            <textarea
              className={inputCls}
              rows={d.channel === "sms" ? 3 : 8}
              value={d.message}
              onChange={(e) => setD({ ...d, message: e.target.value })}
            />
          </Field>
        )}
        {talk && (
          <Field label={d.channel === "call" ? "Call script" : "Agenda"}>
            <textarea
              className={inputCls}
              rows={7}
              value={d.callScript}
              onChange={(e) => setD({ ...d, callScript: e.target.value })}
            />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {d.channel !== "task" && (
            <button
              type="button"
              disabled={!!busy || !lead}
              onClick={() => void ai()}
              className="btn-outline inline-flex items-center gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {busy === "ai"
                ? "Writing…"
                : talk
                  ? d.callScript
                    ? "Rewrite with AI"
                    : `Write the ${d.channel === "call" ? "call script" : "agenda"}`
                  : d.aiGenerated
                    ? "Regenerate"
                    : "Personalise with AI"}
            </button>
          )}
          {d.channel === "email" && (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.autoSend}
                onChange={(e) => setD({ ...d, autoSend: e.target.checked })}
              />
              Send automatically when due
            </label>
          )}
          {d.channel !== "email" && (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.autoReschedule}
                onChange={(e) => setD({ ...d, autoReschedule: e.target.checked })}
              />
              Move to the next business morning if it slips
            </label>
          )}
        </div>
        {d.channel === "sms" && (
          <p className="text-[11px] text-muted-foreground">
            * Texts are tracked as tasks — sending needs an SMS provider.
          </p>
        )}
        {blocked && <p className="text-xs text-rose-700">Can&apos;t approve: {blocked}.</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void save("draft")}
            className="btn-outline text-sm"
          >
            {busy === "draft" ? "Saving…" : "Save for approval"}
          </button>
          <button
            type="button"
            disabled={!!busy || !!blocked}
            onClick={() => void save("pending")}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
          >
            {busy === "pending" ? "Saving…" : "Approve & schedule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Journey ─────────────────────────────────────────────────────────────────
const STEP_REMINDER: Partial<Record<string, TemplateObjective>> = {
  interested: "registration_reminder",
  registration_started: "registration_reminder",
  registered: "add_property",
  property_added: "subscription_promo",
  subscription_started: "finish_checkout",
};
function Journey({
  data,
  priorityOf,
  prepare,
  setDraft,
  go,
}: {
  data: MarketingData;
  priorityOf: (l: Lead) => "high" | "medium" | "low";
  prepare: (l: Lead, o?: { channel?: Channel; objective?: TemplateObjective; at?: Date }) => Draft;
  setDraft: (d: Draft) => void;
  go: Go;
}) {
  const steps = useMemo(
    () => journeyFunnel(data.leads, data.activities),
    [data.leads, data.activities],
  );
  const max = Math.max(1, ...steps.map((s) => s.count));
  const worst = steps
    .slice(1)
    .filter((s) => s.conversion != null)
    .sort((a, b) => (a.conversion ?? 1) - (b.conversion ?? 1))[0];
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy — select it by hand.");
    }
  };
  return (
    <div className="grid gap-4">
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Contacted → Subscribed</h2>
        {worst && (
          <p className="mt-1 text-xs text-muted-foreground">
            Biggest drop-off:{" "}
            <b className="text-foreground">
              {steps[steps.indexOf(worst) - 1].label} → {worst.label}
            </b>{" "}
            ({pct(worst.conversion ?? 0)} make it through).
          </p>
        )}
        <ol className="mt-3 grid gap-1.5">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className="grid grid-cols-[10rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm"
              title={`${s.count} reached ${s.label}${s.stuck ? ` · ${s.stuck} are there now` : ""}`}
            >
              <span className="truncate">{s.label}</span>
              <span className="h-3 rounded-full bg-secondary">
                <span
                  className="block h-3 rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }}
                />
              </span>
              <span className="text-right text-xs tabular-nums">
                <b>{s.count}</b>
                {i > 0 && s.conversion != null && (
                  <span className="text-muted-foreground"> · {pct(s.conversion)}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground">
          * Steps after Interested come from their real CorvusPT account; % is the share of the step
          before.
        </p>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            "subscription_started",
            "property_added",
            "registered",
            "registration_started",
            "interested",
          ] as const
        ).map((stage) => {
          const stuck = data.leads
            .filter((l) => l.stage === stage)
            .sort(
              (a, b) => (priorityOf(a) === "high" ? -1 : 0) - (priorityOf(b) === "high" ? -1 : 0),
            );
          const label = steps.find((s) => s.key === stage)?.label ?? stage;
          return (
            <section key={stage} className="card-elev p-4">
              <h3 className="text-sm font-semibold">
                Stuck at {label} ({stuck.length})
              </h3>
              {stuck.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Nobody.</p>
              ) : (
                <ul className="mt-2 grid gap-1.5">
                  {stuck.slice(0, 12).map((l) => {
                    const links = journeyLinks(l, SITE());
                    const link =
                      stage === "registration_started" || stage === "interested"
                        ? links.registration
                        : stage === "registered"
                          ? links.addProperty
                          : links.checkout;
                    const since =
                      stage === "subscription_started"
                        ? l.subscriptionStartedAt
                        : stage === "property_added"
                          ? l.propertyAddedAt
                          : stage === "registered"
                            ? l.registeredAt
                            : stage === "registration_started"
                              ? l.registrationStartedAt
                              : null;
                    const pending = data.followups.some(
                      (f) => f.leadId === l.id && (f.status === "pending" || f.status === "draft"),
                    );
                    return (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => go("leads", { leadId: l.id })}
                          className="min-w-0 truncate text-left hover:underline"
                        >
                          <PriorityBadge priority={priorityOf(l)} /> {leadName(l)}
                          {since && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {relDays(since)}
                            </span>
                          )}
                        </button>
                        <span className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void copy(link)}
                            className="btn-outline inline-flex items-center gap-1 py-0.5 text-xs"
                            title={link}
                          >
                            <Copy className="h-3 w-3" aria-hidden /> Link
                          </button>
                          {pending ? (
                            <span className="text-xs text-muted-foreground">Follow-up planned</span>
                          ) : (
                            <button
                              type="button"
                              disabled={isDnc(l)}
                              onClick={() =>
                                setDraft(prepare(l, { objective: STEP_REMINDER[stage] }))
                              }
                              className="btn-primary btn-primary-hover py-0.5 text-xs disabled:opacity-50"
                            >
                              Remind
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Performance ─────────────────────────────────────────────────────────────
function Performance({ data, onAiRun }: { data: MarketingData; onAiRun?: (r: AiRun) => void }) {
  const [days, setDays] = useState(30);
  const e = useMemo(() => effectiveness(data, days), [data, days]);
  const brief = data.aiRuns.find((r) => r.scope === "followup-performance") ?? null;
  const tplName = (id: string) => data.templates.find((t) => t.id === id)?.name ?? "Template";
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Last</span>
        <select
          className={sel}
          value={days}
          onChange={(x) => setDays(Number(x.target.value))}
          aria-label="Period"
        >
          {[7, 30, 90].map((n) => (
            <option key={n} value={n}>
              {n} days
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Response rate"
          value={e.responseRate == null ? "—" : pct(e.responseRate)}
          hint={`${e.responses} of ${e.outreach} touches`}
        />
        <StatTile
          label="Overdue now"
          value={e.overdue}
          hint={e.onTime == null ? undefined : `${pct(e.onTime)} done on time`}
        />
        <StatTile label="Registrations" value={e.registrations} hint={`in ${days} days`} />
        <StatTile label="Subscriptions" value={e.conversions} hint={`in ${days} days`} />
        <StatTile
          label="Unfinished registration"
          value={e.abandoned.registration}
          hint="started, not finished (1 day+)"
        />
        <StatTile label="No property yet" value={e.abandoned.property} hint="registered 3 days+" />
        <StatTile
          label="Abandoned checkout"
          value={e.abandoned.checkout}
          hint="opened checkout, 2 hours+"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">By channel</h2>
          <RateTable rows={e.byChannel.map((r) => ({ ...r, label: r.key }))} />
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">By template</h2>
          <RateTable rows={e.byTemplate.map((r) => ({ ...r, label: tplName(r.key) }))} />
        </section>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * A touch counts as working when the lead replied, said they were interested, or moved
        forward a step within 7 days.
      </p>
      <AiBox
        title="Corvus AI — what's working and what to change"
        text={brief?.result ?? null}
        when={brief ? relDays(brief.createdAt) : null}
        runLabel="Review follow-ups"
        run={async () => {
          const r = await runAi({
            scope: "followup-performance",
            instruction:
              "Review these follow-up results. Name what's working (channels, templates, timing) and give 3-5 specific changes to timing, messaging and engagement to lift registrations and subscriptions. Numbered list, under 180 words. Use only the numbers given.",
            context: JSON.stringify({
              ...e,
              byTemplate: e.byTemplate.map((t) => ({ ...t, name: tplName(t.key) })),
            }),
          });
          onAiRun?.(r);
        }}
      />
    </div>
  );
}
function RateTable({
  rows,
}: {
  rows: { label: string; sent: number; responded: number; rate: number | null }[];
}) {
  if (!rows.length)
    return <p className="mt-2 text-sm text-muted-foreground">No outreach in this period.</p>;
  return (
    <table className="mt-2 w-full text-left text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="py-1 font-medium" />
          <th className="py-1 text-right font-medium">Sent</th>
          <th className="py-1 text-right font-medium">Worked</th>
          <th className="py-1 text-right font-medium">Rate</th>
        </tr>
      </thead>
      <tbody>
        {[...rows]
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .map((r) => (
            <tr key={r.label} className="border-t border-border/60">
              <td className="py-1 capitalize">{r.label}</td>
              <td className="py-1 text-right tabular-nums">{r.sent}</td>
              <td className="py-1 text-right tabular-nums">{r.responded}</td>
              <td className="py-1 text-right font-semibold tabular-nums">
                {r.rate == null ? "—" : pct(r.rate)}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

// ── AI sequences (approved steps run by themselves; stop on reply/conversion) ──
type Step = { day: number; channel: Channel; subject: string; message: string };
function parseSequence(text: string): Step[] {
  // Expected blocks: "STEP | day N | channel | subject" then the message lines.
  const steps: Step[] = [];
  const blocks = text.split(/\n(?=\s*\**\s*step\b)/i);
  for (const b of blocks) {
    const head = b.match(
      /step[^|\n]*\|\s*day\s*(\d+)\s*\|\s*(email|call|task|sms|meeting)\s*\|\s*([^\n]*)/i,
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
  return steps.slice(0, 5);
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
  const [autoSend, setAutoSend] = useState(true);
  const [busy, setBusy] = useState(false);
  async function generate() {
    setBusy(true);
    try {
      const links = journeyLinks(lead, SITE());
      const r = await runAi({
        scope: "sequence",
        leadId: lead.id,
        instruction:
          "Plan a 3-step follow-up sequence to move this lead to the next step. Pick the timing (days from today) and channel for each step from their stage, deadline and history " +
          "(email, call, meeting, task; a call after an unanswered email). For each step write exactly one header line 'STEP | day N | channel | subject', then the message (emails under 100 words, call scripts as 3 bullets). " +
          `Use their links where a step is unfinished: registration ${links.registration}, add properties ${links.addProperty}, checkout ${links.checkout}. No made-up facts.`,
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
        const email = s.channel === "email";
        await saveFollowup(null, {
          leadId: lead.id,
          channel: email && (!lead.email || lead.unsubscribedAt) ? "task" : s.channel,
          dueAt: due.toISOString(),
          subject: s.subject,
          message: email ? s.message : null,
          callScript: email ? null : s.message,
          sequenceName: name,
          sequenceStep: i + 1,
          aiGenerated: true,
          assignedTo: lead.assignedTo ?? data.me,
          autoSend: email && autoSend,
          status: "pending",
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
        <h2 className="font-serif text-xl font-semibold">Follow-up sequence — {leadName(lead)}</h2>
        <p className="text-sm text-muted-foreground">
          Corvus AI plans the timing and writes each step. Nothing is scheduled until you approve.
          Approved sequences stop by themselves if they reply, register or opt out.
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
                    Step {i + 1} · day {s.day} · {CHANNEL_LABEL[s.channel]}
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
              />
              Send the email steps automatically when due
            </label>
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

// From Admin: booked appointments (matched to leads by email), invited users
// who haven't signed up, and beta signups who haven't registered — each with a
// prepared follow-up. Read-only: invites and appointments are managed in Admin.
function Signups({
  data,
  prepare,
  setDraft,
  reload,
  go,
}: {
  data: MarketingData;
  prepare: (l: Lead, o?: { channel?: Channel; objective?: TemplateObjective; at?: Date }) => Draft;
  setDraft: (d: Draft) => void;
  reload: () => Promise<void>;
  go: Go;
}) {
  const [appts, setAppts] = useState<MarketingAppointment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    loadAppointments(120)
      .then(setAppts)
      .catch((e) => {
        setAppts([]);
        setErr(getErrorMessage(e, "Couldn't load appointments."));
      });
  }, []);
  const now = Date.now();
  const leadById = new Map(data.leads.map((l) => [l.id, l]));
  const leadByEmail = new Map(
    data.leads.filter((l) => l.email).map((l) => [l.email!.trim().toLowerCase(), l]),
  );
  const upcoming = (appts ?? [])
    .filter((a) => new Date(a.startAt).getTime() > now && a.status !== "cancelled")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const recent = (appts ?? []).filter(
    (a) => new Date(a.startAt).getTime() <= now && now - new Date(a.startAt).getTime() < 30 * 864e5,
  );
  const pendingFor = (id: string) =>
    data.followups.some((f) => f.leadId === id && (f.status === "pending" || f.status === "draft"));
  const invited = data.leads
    .filter((l) => l.invitedAt && !l.profileId && !isDnc(l) && l.stage !== "not_interested")
    .sort((a, b) => (a.invitedAt ?? "").localeCompare(b.invitedAt ?? ""));
  const beta = data.leads
    .filter(
      (l) =>
        (l.betaLeadId || l.source === "beta_signup") &&
        !l.profileId &&
        !isDnc(l) &&
        l.stage !== "not_interested",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const when = (iso: string) =>
    new Date(iso).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const apptRow = (a: MarketingAppointment, past: boolean) => {
    const l =
      (a.leadId ? leadById.get(a.leadId) : undefined) ??
      (a.email ? leadByEmail.get(a.email.trim().toLowerCase()) : undefined);
    return (
      <li
        key={a.id}
        className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 text-sm last:border-0"
      >
        <span className="min-w-0 flex-1">
          <b>{a.name || a.email}</b>
          <span className="text-muted-foreground">
            {" "}
            · {when(a.startAt)}
            {a.meetingType ? ` · ${a.meetingType.replace(/_/g, " ")}` : ""}
            {a.status && a.status !== "booked" && a.status !== "confirmed" ? ` · ${a.status}` : ""}
          </span>
          {a.notes && (
            <span className="block truncate text-xs text-muted-foreground">“{a.notes}”</span>
          )}
        </span>
        {l ? (
          <>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => go("leads", { leadId: l.id })}
            >
              Open lead
            </button>
            <button
              type="button"
              className="btn-outline py-1 text-xs"
              onClick={() =>
                setDraft(
                  prepare(l, {
                    channel: past ? "email" : "call",
                    objective: "follow_up",
                    at: past ? new Date() : new Date(new Date(a.startAt).getTime() - 864e5),
                  }),
                )
              }
            >
              {past ? "Follow up after the meeting" : "Prepare (call the day before)"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={adding === a.id || !a.email}
            className="btn-outline py-1 text-xs"
            onClick={async () => {
              setAdding(a.id);
              try {
                await createLead({
                  fullName: a.name,
                  email: a.email,
                  phone: a.phone,
                  source: "website",
                });
                await reload();
                toast.success("Added to Leads & CRM.");
              } catch (e) {
                toast.error(getErrorMessage(e, "Couldn't add the lead."));
              } finally {
                setAdding(null);
              }
            }}
          >
            {adding === a.id ? "Adding…" : "Add as a lead"}
          </button>
        )}
      </li>
    );
  };
  const leadRow = (l: Lead, since: string | null, label: string) => {
    const d = since ? Math.floor((now - new Date(since).getTime()) / 864e5) : null;
    return (
      <li
        key={l.id}
        className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 text-sm last:border-0"
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left hover:underline"
          onClick={() => go("leads", { leadId: l.id })}
        >
          <b>{leadName(l)}</b>
          <span className="text-muted-foreground">
            {" "}
            · {label} {d == null ? "" : d <= 0 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`}
          </span>
        </button>
        {pendingFor(l.id) ? (
          <span className="text-xs text-muted-foreground">Follow-up planned</span>
        ) : (
          <button
            type="button"
            className="btn-outline py-1 text-xs"
            onClick={() => setDraft(prepare(l, { objective: "registration_reminder" }))}
          >
            Remind to sign up
          </button>
        )}
      </li>
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card-elev p-4 lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Appointments</h2>
          <span className="text-xs text-muted-foreground">
            Booked through CorvusPT · managed in Admin → Appointments
          </span>
        </div>
        {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        {appts === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">
                Upcoming ({upcoming.length})
              </h3>
              {upcoming.length ? (
                <ul>{upcoming.map((a) => apptRow(a, false))}</ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">None booked.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">
                Last 30 days ({recent.length})
              </h3>
              {recent.length ? (
                <ul>{recent.map((a) => apptRow(a, true))}</ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">None.</p>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Invited, not signed up ({invited.length})</h2>
        <p className="text-xs text-muted-foreground">From Admin → Invited Users</p>
        {invited.length ? (
          <ul className="mt-2">
            {invited.slice(0, 40).map((l) => leadRow(l, l.invitedAt, "invited"))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Everyone invited has signed up.</p>
        )}
      </section>
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Beta signups, not registered ({beta.length})</h2>
        <p className="text-xs text-muted-foreground">From Admin → Beta Signups</p>
        {beta.length ? (
          <ul className="mt-2">
            {beta.slice(0, 40).map((l) => leadRow(l, l.createdAt, "signed up for beta"))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Every beta signup has an account.</p>
        )}
      </section>
      <p className="text-[11px] text-muted-foreground lg:col-span-2">
        * Follow-ups can be assigned to any Admin or marketing staff member. Sending invites and
        changing appointments stay in Admin.
      </p>
    </div>
  );
}
