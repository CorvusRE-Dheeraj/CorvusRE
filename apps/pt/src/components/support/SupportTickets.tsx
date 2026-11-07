import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Lock, MessageSquare, RotateCcw, Send, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { useLiveRefresh } from "@/lib/staff-records";
import {
  addTicketNote,
  createTicket,
  getCustomerDetail,
  getTicket,
  isOpenTicket,
  listPermissions,
  listSupportCustomers,
  listTickets,
  slaState,
  supportAction,
  updateTicket,
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type SupportCustomer,
  type TeamMember,
  type Ticket,
  type TicketCategory,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support-console";

export type TicketFilter =
  "open" | "mine" | "overdue" | "urgent" | "escalated" | "unassigned" | "all";
type NewTicketSeed = { profileId: string | null; propertyId?: string | null; subject?: string };

const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const SLA_TONE = {
  ok: "bg-secondary text-foreground",
  soon: "bg-amber-100 text-amber-900",
  overdue: "bg-destructive/10 text-destructive",
  met: "bg-success/15 text-success",
  closed: "bg-secondary text-muted-foreground",
} as const;
const PRIORITY_TONE: Record<TicketPriority, string> = {
  urgent: "text-destructive font-semibold",
  high: "text-amber-700 font-semibold",
  normal: "",
  low: "text-muted-foreground",
};

export function SupportTickets({
  me,
  team,
  filter,
  setFilter,
  openId,
  setOpenId,
  onCustomer,
  newFor,
  clearNew,
}: {
  me: string;
  team: TeamMember[];
  filter: TicketFilter;
  setFilter: (f: TicketFilter) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onCustomer: (profileId: string) => void;
  newFor: NewTicketSeed | null;
  clearNew: () => void;
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [category, setCategory] = useState("");
  const [assignee, setAssignee] = useState("");
  const [customers, setCustomers] = useState<SupportCustomer[]>([]);
  const [newOpen, setNewOpen] = useState<NewTicketSeed | null>(null);
  const load = useCallback(
    () =>
      listTickets({ includeClosed: true })
        .then(setTickets)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load tickets."))),
    [],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => {
    listSupportCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);
  useLiveRefresh(["support_tickets", "support_ticket_messages"], () => void load(), true);

  const nameOf = (id: string | null) =>
    id ? (team.find((t) => t.id === id)?.name ?? "Staff") : "Unassigned";
  const custOf = (id: string | null) => {
    const c = customers.find((x) => x.profileId === id);
    return c ? (c.name ?? c.email ?? "Customer") : id ? "Customer" : "No customer";
  };
  const list = useMemo(
    () =>
      (tickets ?? [])
        .filter((t) =>
          filter === "all"
            ? true
            : filter === "mine"
              ? t.assignedTo === me && isOpenTicket(t)
              : filter === "overdue"
                ? slaState(t).tone === "overdue"
                : filter === "urgent"
                  ? isOpenTicket(t) && (t.priority === "urgent" || t.priority === "high")
                  : filter === "escalated"
                    ? t.status === "escalated"
                    : filter === "unassigned"
                      ? isOpenTicket(t) && !t.assignedTo
                      : isOpenTicket(t),
        )
        .filter((t) => !category || (category === "none" ? !t.category : t.category === category))
        .filter((t) => !assignee || t.assignedTo === assignee)
        .sort(
          (a, b) =>
            Number(isOpenTicket(b)) - Number(isOpenTicket(a)) ||
            slaState(a).minutes - slaState(b).minutes ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [tickets, filter, category, assignee, me],
  );
  const seed = newFor ?? newOpen;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={sel}
          value={filter}
          onChange={(e) => setFilter(e.target.value as TicketFilter)}
          aria-label="Which tickets"
        >
          <option value="open">Open</option>
          <option value="mine">Assigned to me</option>
          <option value="overdue">Response overdue</option>
          <option value="urgent">High / urgent</option>
          <option value="escalated">Escalated</option>
          <option value="unassigned">Unassigned</option>
          <option value="all">All (incl. resolved)</option>
        </select>
        <select
          className={sel}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">Any category</option>
          <option value="none">Uncategorized</option>
          {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          className={sel}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Assigned to"
        >
          <option value="">Anyone</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-accent ml-auto text-sm"
          onClick={() => setNewOpen({ profileId: null })}
        >
          New ticket
        </button>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <ul className="grid content-start gap-2">
          {tickets === null && <li className="text-sm text-muted-foreground">Loading…</li>}
          {tickets && list.length === 0 && (
            <li className="card-elev p-4 text-sm text-muted-foreground">No tickets here.</li>
          )}
          {list.map((t) => {
            const s = slaState(t);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  className={`card-elev w-full p-3 text-left hover:bg-secondary/40 ${openId === t.id ? "ring-2 ring-accent" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">
                      #{t.number} {t.subject}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SLA_TONE[s.tone]}`}
                    >
                      {s.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {custOf(t.profileId)} ·{" "}
                    <span className={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</span>{" "}
                    · {t.category ? CATEGORY_LABEL[t.category] : "Uncategorized"} ·{" "}
                    {STATUS_LABEL[t.status]}
                  </div>
                  <div className="text-xs text-muted-foreground">{nameOf(t.assignedTo)}</div>
                </button>
              </li>
            );
          })}
        </ul>
        {openId ? (
          <TicketDetail
            key={openId}
            id={openId}
            team={team}
            customers={customers}
            onCustomer={onCustomer}
            onChanged={load}
          />
        ) : (
          <p className="card-elev p-6 text-sm text-muted-foreground">Pick a ticket.</p>
        )}
      </div>
      {seed && (
        <NewTicket
          me={me}
          team={team}
          customers={customers}
          initial={seed}
          onClose={() => {
            setNewOpen(null);
            clearNew();
          }}
          onCreated={(t) => {
            setNewOpen(null);
            clearNew();
            void load();
            setOpenId(t.id);
          }}
        />
      )}
    </div>
  );
}

type Draft = {
  reply: string;
  followUps: string[];
  needsSpecialist: boolean;
  specialist: "operations" | "super_admin" | null;
  reason: string | null;
  sources: string[];
};

function TicketDetail({
  id,
  team,
  customers,
  onCustomer,
  onChanged,
}: {
  id: string;
  team: TeamMember[];
  customers: SupportCustomer[];
  onCustomer: (profileId: string) => void;
  onChanged: () => void;
}) {
  const [t, setT] = useState<Ticket | null>(null);
  const [msgs, setMsgs] = useState<TicketMessage[]>([]);
  const [properties, setProperties] = useState<{ id: string; address: string }[]>([]);
  const [reply, setReply] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [instruction, setInstruction] = useState("");
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"internal_note" | "customer_message">("internal_note");
  const [after, setAfter] = useState<"" | "waiting_on_customer" | "resolved">(
    "waiting_on_customer",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [escalate, setEscalate] = useState<{
    to: "operations" | "super_admin";
    reason: string;
  } | null>(null);

  const load = useCallback(async () => {
    const r = await getTicket(id);
    setT(r.ticket);
    setMsgs(r.messages);
    return r.ticket;
  }, [id]);
  useEffect(() => {
    load()
      .then(async (tk) => {
        if (tk.profileId) {
          const d = await getCustomerDetail(tk.profileId).catch(() => null);
          setProperties(d?.properties.map((p) => ({ id: p.id, address: p.address })) ?? []);
        }
        // first time anyone opens an uncategorized ticket: let the AI sort it
        if (!tk.category && !tk.aiSummary) {
          supportAction("ai_ticket", { ticketId: tk.id })
            .then(() => load())
            .catch(() => undefined);
        }
      })
      .catch((e) => toast.error(getErrorMessage(e, "Couldn't load the ticket.")));
  }, [load]);
  useLiveRefresh(
    ["support_ticket_messages", "support_tickets"],
    () => void load().catch(() => undefined),
    true,
  );

  if (!t) return <p className="card-elev p-6 text-sm text-muted-foreground">Loading…</p>;
  const s = slaState(t);
  const open = isOpenTicket(t);
  const customer = customers.find((c) => c.profileId === t.profileId);

  async function patch(p: Parameters<typeof updateTicket>[1], ok?: string) {
    try {
      await updateTicket(t!.id, p);
      await load();
      onChanged();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't update the ticket."));
    }
  }
  async function aiSort() {
    setBusy("sort");
    try {
      const r = await supportAction<{
        category: TicketCategory;
        priority: TicketPriority;
        summary: string;
        needsSpecialist: boolean;
        specialistReason: string | null;
      }>("ai_ticket", { ticketId: t!.id });
      await load();
      toast.success(
        `AI: ${CATEGORY_LABEL[r.category]}, ${PRIORITY_LABEL[r.priority]} priority${r.needsSpecialist ? ` — needs a specialist (${r.specialistReason ?? ""})` : ""}`,
      );
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't read this ticket."));
    } finally {
      setBusy(null);
    }
  }
  async function aiDraft() {
    setBusy("draft");
    try {
      const r = await supportAction<Draft>("ai_draft", { ticketId: t!.id, instruction });
      setDraft(r);
      setReply(r.reply);
      setAiDrafted(true);
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't draft a reply."));
    } finally {
      setBusy(null);
    }
  }
  async function sendReply() {
    setBusy("send");
    try {
      await supportAction("send_reply", {
        ticketId: t!.id,
        body: reply,
        aiDrafted,
        status: after || undefined,
      });
      if (after === "resolved") await notifyResolved(false);
      setReply("");
      setDraft(null);
      setAiDrafted(false);
      await load();
      onChanged();
      toast.success("Reply sent");
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't send the reply."));
    } finally {
      setBusy(null);
    }
  }
  async function notifyResolved(changeStatus = true) {
    if (changeStatus) await patch({ status: "resolved" }, "Resolved");
    if (t!.profileId) {
      const link = `${window.location.origin}${import.meta.env.BASE_URL}ticket-feedback?t=${t!.feedbackToken}`;
      await supportAction("send_template", {
        profileId: t!.profileId,
        template: "ticket_resolved",
        ticketNumber: t!.number,
        link,
      }).catch((e) => toast.error(getErrorMessage(e, "Resolved, but the email didn't send.")));
    }
  }
  async function saveNote() {
    setBusy("note");
    try {
      await addTicketNote(t!.id, noteKind, note);
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-elev p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl font-semibold">
            #{t.number} {t.subject}
          </h3>
          <p className="text-xs text-muted-foreground">
            Opened{" "}
            {new Date(t.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · {t.source.replace(/_/g, " ")}
            {t.reopenedCount > 0 && ` · reopened ${t.reopenedCount}×`}
            {t.rating && ` · rated ${t.rating}/5`}
          </p>
          {t.profileId && (
            <button
              type="button"
              className="mt-1 text-sm text-accent underline"
              onClick={() => onCustomer(t.profileId!)}
            >
              {customer?.name ?? customer?.email ?? "Open customer"}
            </button>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SLA_TONE[s.tone]}`}>
          {s.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-muted-foreground">Status</span>
          <select
            className={`${sel} w-full min-w-0`}
            value={t.status}
            onChange={(e) => void patch({ status: e.target.value as TicketStatus })}
          >
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-muted-foreground">Priority</span>
          <select
            className={`${sel} w-full min-w-0`}
            value={t.priority}
            onChange={(e) => void patch({ priority: e.target.value as TicketPriority })}
          >
            {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((k) => (
              <option key={k} value={k}>
                {PRIORITY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-muted-foreground">Category</span>
          <select
            className={`${sel} w-full min-w-0`}
            value={t.category ?? ""}
            onChange={(e) =>
              void patch({ category: (e.target.value || null) as TicketCategory | null })
            }
          >
            <option value="">Uncategorized</option>
            {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((k) => (
              <option key={k} value={k}>
                {CATEGORY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-muted-foreground">Assigned to</span>
          <select
            className={`${sel} w-full min-w-0`}
            value={t.assignedTo ?? ""}
            onChange={(e) => void patch({ assigned_to: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-muted-foreground">Property</span>
          <select
            className={`${sel} w-full min-w-0`}
            value={t.propertyId ?? ""}
            onChange={(e) => void patch({ property_id: e.target.value || null })}
          >
            <option value="">None</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-outline inline-flex items-center gap-1.5 text-xs"
          onClick={aiSort}
          disabled={busy === "sort"}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
          {busy === "sort" ? "Reading…" : "AI categorize & summarize"}
        </button>
        {open ? (
          <>
            <button
              type="button"
              className="btn-outline inline-flex items-center gap-1.5 text-xs"
              onClick={() => setEscalate({ to: "operations", reason: "" })}
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> Escalate
            </button>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => void notifyResolved()}
            >
              Resolve & notify customer
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-outline inline-flex items-center gap-1.5 text-xs"
            onClick={() => void patch({ status: "open" }, "Reopened")}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen
          </button>
        )}
      </div>
      {t.escalatedTo && (
        <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Escalated to {t.escalatedTo.replace(/_/g, " ")}
          {t.escalationReason && `: ${t.escalationReason}`}
        </p>
      )}
      {escalate && (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm">
          <select
            className={sel}
            value={escalate.to}
            onChange={(e) =>
              setEscalate({ ...escalate, to: e.target.value as "operations" | "super_admin" })
            }
          >
            <option value="operations">Operations (case, filing, valuation questions)</option>
            <option value="super_admin">Super Admin (refunds, exceptions, policy)</option>
          </select>
          <input
            className={sel}
            placeholder="Why it needs a specialist"
            value={escalate.reason}
            onChange={(e) => setEscalate({ ...escalate, reason: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-accent text-xs"
              disabled={escalate.reason.trim().length < 5}
              onClick={() =>
                void patch(
                  {
                    status: "escalated",
                    escalated_to: escalate.to,
                    escalation_reason: escalate.reason.trim(),
                  },
                  "Escalated",
                ).then(() => setEscalate(null))
              }
            >
              Escalate
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => setEscalate(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {t.aiSummary && (
        <div className="mt-4 rounded-md bg-accent/5 p-3 text-sm">
          <div className="flex items-center gap-1 text-xs font-semibold text-accent">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI summary
          </div>
          <p className="mt-1">{t.aiSummary}</p>
        </div>
      )}

      <ol className="mt-4 grid gap-2">
        {msgs.map((m) => (
          <li
            key={m.id}
            className={`rounded-md p-3 text-sm ${
              m.kind === "internal_note"
                ? "border border-dashed border-amber-300 bg-amber-50/60"
                : m.kind === "customer_reply"
                  ? "ml-6 bg-accent/5"
                  : "mr-6 bg-secondary/60"
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {m.kind === "internal_note" ? (
                <>
                  <Lock className="h-3 w-3" aria-hidden /> Internal note
                </>
              ) : m.kind === "customer_reply" ? (
                "Reply to customer"
              ) : (
                "Customer"
              )}
              {m.authorId &&
                m.kind !== "customer_message" &&
                ` · ${team.find((x) => x.id === m.authorId)?.name ?? "Staff"}`}
              {" · "}
              {new Date(m.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {m.aiDrafted && " · AI-drafted, reviewed"}
              {m.automated && " · automated"}
              {m.sendError && <span className="text-destructive"> · not sent: {m.sendError}</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
        {msgs.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
      </ol>

      {t.profileId && (
        <section className="mt-5 grid gap-2 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <Send className="h-4 w-4" aria-hidden /> Reply to the customer
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${sel} w-56 text-xs`}
                placeholder="Optional instruction for AI"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <button
                type="button"
                className="btn-outline inline-flex items-center gap-1.5 text-xs"
                onClick={aiDraft}
                disabled={busy === "draft"}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
                {busy === "draft" ? "Drafting…" : "Draft with AI"}
              </button>
            </div>
          </div>
          {draft?.needsSpecialist && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              AI suggests escalating to {draft.specialist?.replace(/_/g, " ") ?? "a specialist"}:{" "}
              {draft.reason}
            </p>
          )}
          <textarea
            className="min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write the reply — AI drafts appear here for you to review and edit before anything is sent."
            aria-label="Reply"
          />
          {draft && (draft.sources.length > 0 || draft.followUps.length > 0) && (
            <div className="text-xs text-muted-foreground">
              {draft.sources.length > 0 && <div>Based on: {draft.sources.join(", ")}</div>}
              {draft.followUps.length > 0 && <div>Follow-ups: {draft.followUps.join(" · ")}</div>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${sel} text-xs`}
              value={after}
              onChange={(e) => setAfter(e.target.value as typeof after)}
              aria-label="After sending"
            >
              <option value="waiting_on_customer">Then: waiting on customer</option>
              <option value="resolved">Then: resolve (sends the resolved email)</option>
              <option value="">Then: leave status</option>
            </select>
            <button
              type="button"
              className="btn-accent text-sm"
              disabled={reply.trim().length < 2 || busy === "send"}
              onClick={sendReply}
            >
              {busy === "send" ? "Sending…" : "Send reply"}
            </button>
          </div>
        </section>
      )}

      <section className="mt-5 grid gap-2 border-t border-border/60 pt-4">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageSquare className="h-4 w-4" aria-hidden /> Add to the conversation
        </h4>
        <select
          className={`${sel} w-fit text-xs`}
          value={noteKind}
          onChange={(e) => setNoteKind(e.target.value as typeof noteKind)}
          aria-label="Note kind"
        >
          <option value="internal_note">Internal note (never shown to the customer)</option>
          <option value="customer_message">
            Log a customer message (call, email) — restarts the response clock
          </option>
        </select>
        <textarea
          className="min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />
        <button
          type="button"
          className="btn-outline w-fit text-sm"
          disabled={note.trim().length < 2 || busy === "note"}
          onClick={saveNote}
        >
          Save
        </button>
      </section>
    </div>
  );
}

function NewTicket({
  me,
  team,
  customers,
  initial,
  onClose,
  onCreated,
}: {
  me: string;
  team: TeamMember[];
  customers: SupportCustomer[];
  initial: NewTicketSeed;
  onClose: () => void;
  onCreated: (t: Ticket) => void;
}) {
  const [profileId, setProfileId] = useState(initial.profileId ?? "");
  const [propertyId, setPropertyId] = useState(initial.propertyId ?? "");
  const [properties, setProperties] = useState<{ id: string; address: string }[]>([]);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [source, setSource] = useState<Ticket["source"]>("phone");
  const [assignedTo, setAssignedTo] = useState(me);
  const [message, setMessage] = useState("");
  const [ack, setAck] = useState(true);
  const [ackAllowed, setAckAllowed] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listPermissions()
      .then((p) => setAckAllowed(!!p.find((x) => x.key === "automated_replies")?.enabled))
      .catch(() => setAckAllowed(false));
  }, []);
  useEffect(() => {
    if (!profileId) return setProperties([]);
    getCustomerDetail(profileId)
      .then((d) => setProperties(d.properties.map((p) => ({ id: p.id, address: p.address }))))
      .catch(() => setProperties([]));
  }, [profileId]);
  const matches = q.trim()
    ? customers
        .filter((c) =>
          [c.name, c.email, c.company]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q.trim().toLowerCase())),
        )
        .slice(0, 8)
    : [];
  const chosen = customers.find((c) => c.profileId === profileId);
  async function create() {
    setBusy(true);
    try {
      const t = await createTicket({
        profileId: profileId || null,
        propertyId: propertyId || null,
        subject,
        category: category || null,
        priority,
        source,
        assignedTo: assignedTo || null,
        message,
      });
      // approved automated workflow: "we received your request"
      if (ack && ackAllowed && profileId && source !== "staff") {
        await supportAction("send_template", {
          profileId,
          template: "ticket_received",
          ticketNumber: t.number,
          ticketId: t.id,
        }).catch(() => undefined);
      }
      if (!category) void supportAction("ai_ticket", { ticketId: t.id }).catch(() => undefined);
      toast.success(`Ticket #${t.number} created`);
      onCreated(t);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't create the ticket."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New ticket"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-background p-5 shadow-xl">
        <h3 className="font-serif text-lg font-semibold">New ticket</h3>
        <div className="mt-3 grid gap-3 text-sm">
          {chosen ? (
            <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
              <span>{chosen.name ?? chosen.email}</span>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setProfileId("")}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="grid gap-1">
              <input
                className={sel}
                placeholder="Find the customer (name, email, company)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Customer"
              />
              {matches.map((c) => (
                <button
                  key={c.profileId}
                  type="button"
                  className="rounded px-2 py-1 text-left hover:bg-secondary"
                  onClick={() => (setProfileId(c.profileId), setQ(""))}
                >
                  {c.name ?? c.email}{" "}
                  <span className="text-xs text-muted-foreground">{c.email}</span>
                </button>
              ))}
            </div>
          )}
          {properties.length > 0 && (
            <select
              className={sel}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              aria-label="Property"
            >
              <option value="">No specific property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          )}
          <input
            className={sel}
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className={sel}
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory | "")}
              aria-label="Category"
            >
              <option value="">Category: let AI decide</option>
              {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((k) => (
                <option key={k} value={k}>
                  {CATEGORY_LABEL[k]}
                </option>
              ))}
            </select>
            <select
              className={sel}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              aria-label="Priority"
            >
              {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((k) => (
                <option key={k} value={k}>
                  {PRIORITY_LABEL[k]} priority
                </option>
              ))}
            </select>
            <select
              className={sel}
              value={source}
              onChange={(e) => setSource(e.target.value as Ticket["source"])}
              aria-label="Received by"
            >
              <option value="phone">Received by phone</option>
              <option value="email">Received by email</option>
              <option value="staff">Raised by staff</option>
            </select>
            <select
              className={sel}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              aria-label="Assign to"
            >
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="min-h-[100px] rounded-md border border-input bg-background px-3 py-2"
            placeholder={source === "staff" ? "Details (internal note)" : "What the customer said"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Details"
          />
          {ackAllowed && source !== "staff" && profileId && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{" "}
              Send the approved &quot;we received your request&quot; email
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent text-sm"
            disabled={busy || subject.trim().length < 3}
            onClick={create}
          >
            {busy ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
