import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  History,
  Inbox,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { getErrorMessage } from "@/lib/error-message";
import {
  APPROVAL_KIND_LABEL,
  DEPARTMENT_LABEL,
  ENTITY_DEPARTMENT,
  assignOwner,
  ENTITY_LABEL,
  TRANSFER_TARGETS,
  canRespond,
  cancelApproval,
  cancelTransfer,
  decideApproval,
  listApprovals,
  listAutomations,
  listEvents,
  listRouting,
  listTransfers,
  lookupCustomer,
  requestApproval,
  requestTransfer,
  respondTransfer,
  setDefaultOwner,
  staffDirectory,
  useLiveRefresh,
  type Approval,
  type ApprovalKind,
  type AutomationPermission,
  type CustomerLookup,
  type Department,
  type EntityType,
  type RecordEvent,
  type Routing,
  type StaffMember,
  type Transfer,
} from "@/lib/staff-records";

import type { StaffContext } from "@/hooks/use-staff-context";
export type { StaffContext } from "@/hooks/use-staff-context";

const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// ── owner + hand off ────────────────────────────────────────────────────────
export function OwnerHandoff({
  ctx,
  entityType,
  entityId,
  ownerId,
  label,
  onChanged,
  compact,
}: {
  ctx: StaffContext;
  entityType: EntityType;
  entityId: string;
  ownerId: string | null;
  label: string;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Transfer | null>(null);
  const load = useCallback(() => {
    listTransfers({ pendingOnly: true, entityId })
      .then((t) => setPending(t[0] ?? null))
      .catch(() => setPending(null));
  }, [entityId]);
  useEffect(load, [load]);
  if (!ownerId) {
    const dept = ENTITY_DEPARTMENT[entityType];
    const people = ctx.staff.filter((s) => s.isSuperAdmin || s.departments.includes(dept));
    return (
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground">
          <UserRound className="h-3 w-3" /> Needs an owner
        </span>
        <select
          aria-label="Assign an owner"
          value=""
          onChange={(e) =>
            e.target.value &&
            void assignOwner(entityType, entityId, e.target.value)
              .then(() => (toast.success("Owner assigned."), onChanged?.()))
              .catch((err) => toast.error(getErrorMessage(err, "Couldn't assign it.")))
          }
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="">Assign owner…</option>
          {people.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === ctx.me ? `${s.name} (me)` : s.name}
              {s.isSuperAdmin ? " (Super Admin)" : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
          ownerId ? "bg-secondary text-foreground" : "bg-warning/15 text-warning-foreground"
        }`}
        title="The one person responsible for this"
      >
        <UserRound className="h-3 w-3" />
        {ownerId ? `Owner: ${ctx.nameOf(ownerId)}` : "Needs an owner"}
      </span>
      {pending ? (
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">
          Handoff to{" "}
          {pending.toOwner ? ctx.nameOf(pending.toOwner) : DEPARTMENT_LABEL[pending.toDepartment]}{" "}
          pending
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-outline inline-flex items-center gap-1 py-1 text-xs"
        >
          <ArrowRightLeft className="h-3 w-3" /> Hand off
        </button>
      )}
      {open && (
        <TransferDialog
          ctx={ctx}
          entityType={entityType}
          entityId={entityId}
          label={label}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

export function TransferDialog({
  ctx,
  entityType,
  entityId,
  label,
  onClose,
  onDone,
}: {
  ctx: StaffContext;
  entityType: EntityType;
  entityId: string;
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const targets = TRANSFER_TARGETS[entityType];
  const [dept, setDept] = useState<Department>(targets[0]);
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [todo, setTodo] = useState("");
  const [busy, setBusy] = useState(false);
  const people = ctx.staff.filter(
    (s) => s.id !== ctx.me && (s.isSuperAdmin || s.departments.includes(dept)),
  );
  const submit = async () => {
    setBusy(true);
    try {
      await requestTransfer({
        entityType,
        entityId,
        toDepartment: dept,
        toOwner: owner || null,
        reason,
        pending: todo
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Handoff sent — it moves once they accept.");
      onDone();
    } catch (e) {
      toast.error(getErrorMessage(e, "Something went wrong — please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="font-serif text-xl font-semibold">
        Hand off {ENTITY_LABEL[entityType].toLowerCase()}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      <div className="mt-4 grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="font-medium">To</span>
          <select
            className={input}
            value={dept}
            onChange={(e) => (setDept(e.target.value as Department), setOwner(""))}
          >
            {targets.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Receiving person</span>
          <select className={input} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Anyone in {DEPARTMENT_LABEL[dept]} (first to accept)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isSuperAdmin ? " (Super Admin)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Reason *</span>
          <textarea
            className={input}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why it's moving and what they need to know"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Extra to-dos (optional, one per line)</span>
          <textarea
            className={input}
            rows={2}
            value={todo}
            onChange={(e) => setTodo(e.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          The recent history and every open follow-up, ticket and case for this customer go with it
          automatically.
          {entityType === "lead" || entityType === "followup" || entityType === "onboarding"
            ? " Marketing emails and texts to this customer pause until it's accepted."
            : ""}
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary btn-primary-hover disabled:opacity-60"
          disabled={busy || reason.trim().length < 5}
          onClick={() => void submit()}
        >
          {busy ? "Sending…" : "Send handoff"}
        </button>
      </div>
    </Modal>
  );
}

// ── handoff inbox ───────────────────────────────────────────────────────────
export function HandoffInbox({ ctx, department }: { ctx: StaffContext; department?: Department }) {
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    listTransfers({ limit: 60 })
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(["record_transfers"], load, !!ctx.me);
  if (!rows || !ctx.me || !ctx.role) return null;
  const isSuper = ctx.role.isSuperAdmin;
  const relevant = rows.filter(
    (t) => !department || t.toDepartment === department || t.fromDepartment === department,
  );
  const incoming = relevant.filter(
    (t) => canRespond(t, ctx.me!, ctx.departments, isSuper) && t.requestedBy !== ctx.me,
  );
  const outgoing = relevant.filter((t) => t.status === "pending" && t.requestedBy === ctx.me);
  const recent = relevant.filter((t) => t.status !== "pending").slice(0, 5);
  if (!incoming.length && !outgoing.length && !recent.length) return null;
  return (
    <section className="card-elev mt-4 p-4" aria-label="Handoffs">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Inbox className="h-4 w-4 text-accent" /> Handoffs
        {incoming.length > 0 && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            {incoming.length} waiting for you
          </span>
        )}
      </h2>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
        {incoming.map((t) => (
          <TransferCard
            key={t.id}
            t={t}
            ctx={ctx}
            open={open === t.id}
            onToggle={() => setOpen(open === t.id ? null : t.id)}
            onDone={load}
            respond
          />
        ))}
        {outgoing.map((t) => (
          <TransferCard
            key={t.id}
            t={t}
            ctx={ctx}
            open={open === t.id}
            onToggle={() => setOpen(open === t.id ? null : t.id)}
            onDone={load}
          />
        ))}
        {recent.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Recent handoffs ({recent.length})
            </summary>
            <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
              {recent.map((t) => (
                <li key={t.id} className="[overflow-wrap:anywhere]">
                  {when(t.respondedAt ?? t.createdAt)} — {ENTITY_LABEL[t.entityType]} “
                  {t.entityLabel}” {DEPARTMENT_LABEL[t.fromDepartment]} →{" "}
                  {t.toOwner ? ctx.nameOf(t.toOwner) : DEPARTMENT_LABEL[t.toDepartment]}:{" "}
                  <strong>{t.status}</strong>
                  {t.responseNote ? ` (${t.responseNote})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function TransferCard({
  t,
  ctx,
  open,
  onToggle,
  onDone,
  respond,
}: {
  t: Transfer;
  ctx: StaffContext;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
  respond?: boolean;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      onDone();
    } catch (e) {
      toast.error(getErrorMessage(e, "Something went wrong — please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${respond ? "border-accent/50 bg-accent/5" : "border-border"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-medium">
            {ENTITY_LABEL[t.entityType]}: {t.entityLabel ?? "—"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {respond
              ? `From ${ctx.nameOf(t.requestedBy)} (${DEPARTMENT_LABEL[t.fromDepartment]})`
              : `To ${t.toOwner ? ctx.nameOf(t.toOwner) : DEPARTMENT_LABEL[t.toDepartment]}`}{" "}
            · {when(t.createdAt)} · {t.reason}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-3 grid gap-3 border-t border-border pt-3">
          {t.pendingActions.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Still open
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs">
                {t.pendingActions.map((p, i) => (
                  <li key={i}>
                    • <span className="text-muted-foreground">{p.kind}:</span> {p.what}
                    {p.due ? ` (due ${new Date(p.due).toLocaleDateString()})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {t.history.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                History
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {t.history.slice(0, 10).map((h, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    {when(h.at)} — {h.by}: {h.what}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {t.pausedOutreach && (
            <p className="text-xs text-warning-foreground">
              Marketing outreach to this customer is paused while this is open.
            </p>
          )}
          {respond ? (
            <div className="grid gap-2">
              <input
                className={input}
                placeholder="Note (required to decline)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary btn-primary-hover py-1.5 text-sm disabled:opacity-60"
                  onClick={() =>
                    void act(() => respondTransfer(t.id, true, note), "Accepted — it's yours now.")
                  }
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy || note.trim().length < 3}
                  className="btn-outline py-1.5 text-sm disabled:opacity-60"
                  onClick={() =>
                    void act(
                      () => respondTransfer(t.id, false, note),
                      "Declined — the sender was told.",
                    )
                  }
                >
                  Decline
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="btn-outline w-fit py-1 text-xs"
              onClick={() => void act(() => cancelTransfer(t.id), "Handoff cancelled.")}
            >
              Cancel handoff
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── shared history ──────────────────────────────────────────────────────────
export function RecordHistory({
  profileId,
  leadId,
  entityId,
  title = "History",
  limit = 30,
  all,
}: {
  profileId?: string | null;
  leadId?: string | null;
  entityId?: string | null;
  title?: string;
  limit?: number;
  /** everything this person may see (Super Admin activity feed) */
  all?: boolean;
}) {
  const [rows, setRows] = useState<RecordEvent[] | null>(null);
  const load = useCallback(() => {
    if (!all && !profileId && !leadId && !entityId) return setRows([]);
    listEvents({ profileId, leadId, entityId, limit })
      .then(setRows)
      .catch(() => setRows([]));
  }, [profileId, leadId, entityId, limit, all]);
  useEffect(load, [load]);
  useLiveRefresh(["record_events"], load);
  return (
    <section className="text-sm">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" /> {title}
      </h3>
      {!rows ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
          {rows.map((e) => (
            <li
              key={e.id}
              className="border-b border-border/60 py-1 text-xs last:border-0 [overflow-wrap:anywhere]"
            >
              <span className="text-muted-foreground">
                {when(e.createdAt)} · {e.actorLabel ?? "System"} ·{" "}
              </span>
              {e.summary}
              {e.approvalId && (
                <span
                  className="ml-1 inline-flex items-center gap-0.5 rounded bg-secondary px-1 text-[10px] text-muted-foreground"
                  title={`Approval ${e.approvalId}`}
                >
                  <ShieldCheck className="h-3 w-3" /> approval #{e.approvalId.slice(0, 8)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── request an approval ─────────────────────────────────────────────────────
const ROLE_OPTIONS = [
  ["marketing_admin", "Marketing Admin"],
  ["marketing_supervisor", "Marketing Supervisor"],
  ["support_admin", "Customer Support Admin"],
  ["operations_admin", "Operations Admin"],
  ["is_admin", "Super Admin"],
] as const;

export function RequestApprovalButton({
  ctx,
  kind,
  email,
  label = "Request approval",
  aiRationale,
  className,
}: {
  ctx: StaffContext;
  kind?: ApprovalKind;
  email?: string | null;
  label?: string;
  /** set when the request comes from an AI suggestion */
  aiRationale?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "btn-outline inline-flex items-center gap-1.5 text-sm"}
      >
        {aiRationale ? (
          <Sparkles className="h-3.5 w-3.5" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}{" "}
        {label}
      </button>
      {open && (
        <RequestApprovalDialog
          ctx={ctx}
          initialKind={kind}
          initialEmail={email ?? ""}
          aiRationale={aiRationale}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function RequestApprovalDialog({
  ctx,
  initialKind,
  initialEmail = "",
  aiRationale,
  onClose,
  onDone,
}: {
  ctx: StaffContext;
  initialKind?: ApprovalKind;
  initialEmail?: string;
  aiRationale?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<ApprovalKind>(initialKind ?? "pricing_exception");
  const [email, setEmail] = useState(initialEmail);
  const [found, setFound] = useState<CustomerLookup | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [pct, setPct] = useState("10");
  const [duration, setDuration] = useState<"once" | "forever" | "repeating">("once");
  const [months, setMonths] = useState("12");
  const [amount, setAmount] = useState("");
  const [agreement, setAgreement] = useState<"engagement_packet" | "service_agreement">(
    "engagement_packet",
  );
  const [recordId, setRecordId] = useState("");
  const [role, setRole] = useState<string>("support_admin");
  const [enabled, setEnabled] = useState(true);
  const [autoKey, setAutoKey] = useState("");
  const [autos, setAutos] = useState<AutomationPermission[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isSuper = !!ctx.role?.isSuperAdmin;
  useEffect(() => {
    if (kind === "automation_permission")
      listAutomations()
        .then(setAutos)
        .catch(() => setAutos([]));
  }, [kind]);
  const needsCustomer = kind !== "automation_permission";
  const find = async () => {
    try {
      const r = await lookupCustomer(email);
      setFound(r);
      setPropertyId(kind === "refund" ? (r.properties.find((p) => p.subscribed)?.id ?? "") : "");
      setRecordId("");
    } catch (e) {
      setFound(null);
      toast.error(getErrorMessage(e, "Something went wrong — please try again."));
    }
  };
  const payload = (): Record<string, unknown> => {
    switch (kind) {
      case "pricing_exception":
        return {
          email,
          percent_off: Number(pct),
          duration,
          duration_in_months: duration === "repeating" ? Number(months) : null,
          property_id: propertyId || null,
        };
      case "refund":
        return { email, property_id: propertyId, amount: amount || null };
      case "agreement_change":
        return { email, agreement, record_id: recordId || null, property_id: propertyId || null };
      case "access_change":
        return { email, role, enabled };
      case "automation_permission":
        return { key: autoKey, enabled };
    }
  };
  const submit = async (decideNow: boolean) => {
    setBusy(true);
    try {
      const r = await requestApproval({
        kind,
        payload: payload(),
        reason,
        decideNow,
        ...(aiRationale ? { source: "ai" as const, aiRationale } : {}),
      });
      if (r.status === "executed") toast.success("Approved and done.");
      else if (r.status === "failed")
        toast.error(`Approved, but it couldn't be carried out: ${r.error}`);
      else toast.success("Sent to the Super Admin for approval.");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, "Something went wrong — please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="font-serif text-xl font-semibold">
        {isSuper ? "Approve an action" : "Request approval"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSuper
          ? "As Super Admin you can do it now — it's still recorded with its reason."
          : "A Super Admin reviews it; once approved it's carried out and recorded with who approved it."}
      </p>
      {aiRationale && (
        <p className="mt-2 rounded-md bg-secondary/60 p-2 text-xs">
          <Sparkles className="mr-1 inline h-3 w-3" />
          Suggested by Corvus AI: {aiRationale}
        </p>
      )}
      <div className="mt-4 grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="font-medium">What</span>
          <select
            className={input}
            value={kind}
            onChange={(e) => (setKind(e.target.value as ApprovalKind), setFound(null))}
          >
            {(Object.keys(APPROVAL_KIND_LABEL) as ApprovalKind[]).map((k) => (
              <option key={k} value={k}>
                {APPROVAL_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {needsCustomer && (
          <div className="grid gap-1">
            <span className="font-medium">
              {kind === "access_change" ? "Person's email" : "Customer's email"}
            </span>
            <div className="flex gap-2">
              <input
                className={input}
                type="email"
                value={email}
                onChange={(e) => (setEmail(e.target.value), setFound(null))}
              />
              {kind !== "access_change" && (
                <button
                  type="button"
                  className="btn-outline shrink-0 text-sm"
                  onClick={() => void find()}
                  disabled={!email.includes("@")}
                >
                  Look up
                </button>
              )}
            </div>
          </div>
        )}
        {(kind === "pricing_exception" || kind === "refund") && found && (
          <label className="grid gap-1">
            <span className="font-medium">
              Property{kind === "pricing_exception" ? " (optional)" : ""}
            </span>
            <select
              className={input}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              {kind === "pricing_exception" && (
                <option value="">Every property on the account</option>
              )}
              {kind === "refund" && <option value="">Choose…</option>}
              {found.properties
                .filter((p) => kind !== "refund" || p.subscribed)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                    {p.subscribed ? " — subscribed" : ""}
                  </option>
                ))}
            </select>
            {kind === "refund" && !found.properties.some((p) => p.subscribed) && (
              <span className="text-xs text-destructive">
                No paid subscriptions on this account.
              </span>
            )}
          </label>
        )}
        {kind === "pricing_exception" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="font-medium">% off</span>
              <input
                className={input}
                type="number"
                min={1}
                max={100}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">For</span>
              <select
                className={input}
                value={duration}
                onChange={(e) => setDuration(e.target.value as typeof duration)}
              >
                <option value="once">The first year</option>
                <option value="forever">Every year</option>
                <option value="repeating">A number of months</option>
              </select>
            </label>
            {duration === "repeating" && (
              <label className="grid gap-1">
                <span className="font-medium">Months</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={36}
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                />
              </label>
            )}
          </div>
        )}
        {kind === "refund" && (
          <label className="grid gap-1">
            <span className="font-medium">Amount (leave empty for the full latest payment)</span>
            <input
              className={input}
              type="number"
              min={1}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="$"
            />
          </label>
        )}
        {kind === "agreement_change" && (
          <>
            <label className="grid gap-1">
              <span className="font-medium">Agreement</span>
              <select
                className={input}
                value={agreement}
                onChange={(e) => (
                  setAgreement(e.target.value as typeof agreement),
                  setRecordId("")
                )}
              >
                <option value="engagement_packet">
                  Engagement packet (terms, service agreement, agent form, AI acknowledgement)
                </option>
                <option value="service_agreement">Service agreement for one property</option>
              </select>
            </label>
            {found && agreement === "service_agreement" && (
              <label className="grid gap-1">
                <span className="font-medium">Which</span>
                <select
                  className={input}
                  value={recordId}
                  onChange={(e) => setRecordId(e.target.value)}
                >
                  <option value="">Most recent</option>
                  {found.serviceAgreements.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.address ?? "Property"} — signed{" "}
                      {new Date(s.acceptedAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {found && (
              <span className="text-xs text-muted-foreground">
                {agreement === "engagement_packet"
                  ? found.engagementPacket
                    ? `Signed ${new Date(found.engagementPacket.signedAt).toLocaleDateString()}. Approving voids it — the customer is asked to sign again.`
                    : "No signed packet on file."
                  : `${found.serviceAgreements.length} signed. Approving voids it and the packet — the customer signs again.`}
              </span>
            )}
          </>
        )}
        {kind === "access_change" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="font-medium">Role</span>
              <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Change</span>
              <select
                className={input}
                value={enabled ? "on" : "off"}
                onChange={(e) => setEnabled(e.target.value === "on")}
              >
                <option value="on">Give access</option>
                <option value="off">Remove access</option>
              </select>
            </label>
          </div>
        )}
        {kind === "automation_permission" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="font-medium">Automation</span>
              <select
                className={input}
                value={autoKey}
                onChange={(e) => {
                  setAutoKey(e.target.value);
                  const a = autos.find((x) => x.key === e.target.value);
                  if (a) setEnabled(!a.enabled);
                }}
              >
                <option value="">Choose…</option>
                {autos.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label} ({a.enabled ? "on" : "off"})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Turn</span>
              <select
                className={input}
                value={enabled ? "on" : "off"}
                onChange={(e) => setEnabled(e.target.value === "on")}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        )}
        <label className="grid gap-1">
          <span className="font-medium">Reason *</span>
          <textarea
            className={input}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancel
        </button>
        {isSuper ? (
          <button
            type="button"
            disabled={busy || reason.trim().length < 5}
            className="btn-primary btn-primary-hover disabled:opacity-60"
            onClick={() => void submit(true)}
          >
            {busy ? "Working…" : "Approve & do it now"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || reason.trim().length < 5}
            className="btn-primary btn-primary-hover disabled:opacity-60"
            onClick={() => void submit(false)}
          >
            {busy ? "Sending…" : "Send for approval"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── approvals list (Super Admin decides; staff see their own) ───────────────
const STATUS_TONE: Record<Approval["status"], string> = {
  pending: "bg-warning/15 text-warning-foreground",
  approved: "bg-accent/15 text-accent",
  executed: "bg-success/15 text-success",
  rejected: "bg-secondary text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-secondary text-muted-foreground",
};

export function ApprovalsPanel({ ctx, title }: { ctx: StaffContext; title?: string }) {
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => {
    listApprovals({ limit: 100 })
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(["approval_requests"], load);
  const isSuper = !!ctx.role?.isSuperAdmin;
  const decide = async (a: Approval, approve: boolean) => {
    setBusy(a.id);
    try {
      const r = await decideApproval(a.id, approve, notes[a.id]);
      if (r.status === "failed")
        toast.error(`Approved, but it couldn't be carried out: ${r.error}`);
      else toast.success(approve ? "Approved and done." : "Rejected — the requester was told.");
      load();
    } catch (e) {
      toast.error(getErrorMessage(e, "Something went wrong — please try again."));
    } finally {
      setBusy(null);
    }
  };
  if (!rows) return <p className="text-sm text-muted-foreground">Loading approvals…</p>;
  const pending = rows.filter((a) => a.status === "pending");
  const done = rows.filter((a) => a.status !== "pending");
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {title ?? (isSuper ? "Approvals" : "My approval requests")}
        </h2>
        <RequestApprovalButton ctx={ctx} />
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isSuper ? "Nothing waiting for approval." : "No requests waiting."}
        </p>
      ) : (
        pending.map((a) => (
          <div key={a.id} className="card-elev grid gap-2 p-4 text-sm [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge-soft">{APPROVAL_KIND_LABEL[a.kind]}</span>
              {a.source === "ai" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                  <Sparkles className="h-3 w-3" /> AI suggestion
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {ctx.nameOf(a.requestedBy)} · {when(a.createdAt)}
              </span>
            </div>
            <div className="font-medium">{a.title}</div>
            <div className="text-muted-foreground">Reason: {a.reason}</div>
            {a.aiRationale && (
              <div className="text-xs text-muted-foreground">AI's reasoning: {a.aiRationale}</div>
            )}
            {isSuper ? (
              <div className="grid gap-2">
                <input
                  className={input}
                  placeholder="Note (optional)"
                  value={notes[a.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === a.id}
                    className="btn-primary btn-primary-hover py-1.5 text-sm disabled:opacity-60"
                    onClick={() => void decide(a, true)}
                  >
                    {busy === a.id
                      ? "Working…"
                      : a.kind === "refund"
                        ? "Approve & refund"
                        : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === a.id}
                    className="btn-outline py-1.5 text-sm disabled:opacity-60"
                    onClick={() => void decide(a, false)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              a.requestedBy === ctx.me && (
                <button
                  type="button"
                  className="btn-outline w-fit py-1 text-xs"
                  onClick={() =>
                    void cancelApproval(a.id)
                      .then(load)
                      .catch((e) =>
                        toast.error(getErrorMessage(e, "Something went wrong — please try again.")),
                      )
                  }
                >
                  Cancel request
                </button>
              )
            )}
          </div>
        ))
      )}
      {done.length > 0 && (
        <div className="card-elev p-4">
          <h3 className="text-sm font-semibold">Decided</h3>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1 text-xs">
            {(showAll ? done : done.slice(0, 8)).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1 last:border-0 [overflow-wrap:anywhere]"
              >
                <span className={`rounded-full px-2 py-0.5 ${STATUS_TONE[a.status]}`}>
                  {a.status}
                </span>
                <span className="min-w-0 flex-1">{a.title}</span>
                <span className="text-muted-foreground">
                  {a.decidedBy ? `${ctx.nameOf(a.decidedBy)} · ` : ""}
                  {when(a.decidedAt ?? a.createdAt)} · #{a.id.slice(0, 8)}
                </span>
                {a.error && <span className="basis-full text-destructive">{a.error}</span>}
                {a.decisionNote && (
                  <span className="basis-full text-muted-foreground">Note: {a.decisionNote}</span>
                )}
              </li>
            ))}
          </ul>
          {done.length > 8 && (
            <button
              type="button"
              className="mt-2 text-xs text-accent hover:underline"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show fewer" : `Show all ${done.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ── automation switches + default owners (Super Admin settings) ─────────────
export function AutomationSwitches({ ctx }: { ctx: StaffContext }) {
  const [rows, setRows] = useState<AutomationPermission[] | null>(null);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => {
    listAutomations()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(["approval_requests"], load);
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Automation permissions</h2>
        <button type="button" className="btn-outline text-xs" onClick={() => setAsking(true)}>
          {ctx.role?.isSuperAdmin ? "Change an automation" : "Request a change"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Turning one on or off needs a Super Admin approval and is recorded.
      </p>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 text-sm">
        {(rows ?? []).map((a) => (
          <li key={a.key} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium">{a.label}</span>
              <span className="block text-xs text-muted-foreground">{a.description}</span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}
            >
              {a.enabled ? "On" : "Off"}
            </span>
          </li>
        ))}
      </ul>
      {asking && (
        <RequestApprovalDialog
          ctx={ctx}
          initialKind="automation_permission"
          onClose={() => setAsking(false)}
          onDone={load}
        />
      )}
    </section>
  );
}

export function DefaultOwners({ ctx }: { ctx: StaffContext }) {
  const [rows, setRows] = useState<Routing[]>([]);
  const load = useCallback(() => {
    listRouting()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  return (
    <section className="card-elev p-4">
      <h2 className="text-sm font-semibold">Default owners</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        New work goes to the least-busy member of each team. When a team has nobody, it goes to this
        person — so every lead, ticket and case always has one owner.
      </p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {(["marketing", "support", "operations"] as Department[]).map((d) => {
          const r = rows.find((x) => x.department === d);
          return (
            <label key={d} className="grid gap-1">
              <span className="font-medium">{DEPARTMENT_LABEL[d]}</span>
              <select
                className={input}
                value={r?.defaultOwner ?? ""}
                disabled={!ctx.role?.isSuperAdmin}
                onChange={(e) =>
                  void setDefaultOwner(d, e.target.value || null)
                    .then(() => (toast.success("Default owner saved."), load()))
                    .catch((err) =>
                      toast.error(getErrorMessage(err, "Something went wrong — please try again.")),
                    )
                }
              >
                <option value="">Nobody</option>
                {ctx.staff
                  .filter((s) => s.isSuperAdmin || s.departments.includes(d))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isSuperAdmin ? " (Super Admin)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}

/** Small wrapper: a collapsible section used in detail panels. */
export function Collapsible({
  title,
  children,
  defaultOpen,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
