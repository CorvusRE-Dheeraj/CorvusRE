import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  checkIsAdmin,
  listLeads,
  listAllProjects,
  listAllDesignRequests,
  listAllPermits,
  listAllDocuments,
  listEngagementRequests,
  updateEngagementStatus,
  getDocumentSignedUrl,
  listAiLogs,
  listAllUsers,
  setUserIsAdmin,
  listInvitedUsers,
  deleteInvitedUser,
  sendSignupInvite,
  listAuditLog,
  logAdminAction,
  type LeadRow,
  type AdminProjectRow,
  type AdminDesignRow,
  type AdminPermitRow,
  type AdminDocumentRow,
  type AdminEngagementRow,
  type AiLogRow,
  type AdminUserRow,
  type InvitedUserRow,
  type AdminAuditLogRow,
} from "@/lib/admin";
import {
  nextDesignStage,
  advanceDesignRequestStage,
  DESIGN_STAGE_LABEL,
  type DesignStage,
} from "@/lib/design-requests";
import { dateShort, daysUntil } from "@/lib/format";
import { Section, Pill, Stat, Field, inputCls, humanize } from "@/components/dp-ui";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — CorvusDP" }] }),
  component: Admin,
});

type Tab =
  | "projects"
  | "design"
  | "engagements"
  | "permits"
  | "documents"
  | "leads"
  | "ai logs"
  | "users"
  | "invited"
  | "financials"
  | "activity"
  | "settings";

const TABS: Tab[] = [
  "projects",
  "design",
  "engagements",
  "permits",
  "documents",
  "leads",
  "ai logs",
  "users",
  "invited",
  "financials",
  "activity",
  "settings",
];

const AI_KIND_LABEL: Record<string, string> = {
  feasibility_summary: "Feasibility summary",
  design_narrative: "Design narrative",
  review_comment_translation: "Review comment translation",
  assistant_chat: "Assistant chat",
};

function leadPriority(score: number): { label: string; tone: "red" | "amber" | "gray" } {
  if (score >= 7) return { label: "High", tone: "red" };
  if (score >= 4) return { label: "Medium", tone: "amber" };
  return { label: "Low", tone: "gray" };
}

function Admin() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("projects");
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [permitFilter, setPermitFilter] = useState<"all" | "at_risk" | "expiring">("all");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/admin-login" });
      return;
    }
    checkIsAdmin(user.id).then((ok) => {
      setAuthorized(ok);
      if (!ok) nav({ to: "/admin-login" });
    });
  }, [user, loading, nav]);

  const projects = useQuery<AdminProjectRow[]>({
    queryKey: ["admin", "projects"],
    queryFn: listAllProjects,
    enabled: authorized === true,
  });
  const design = useQuery<AdminDesignRow[]>({
    queryKey: ["admin", "design"],
    queryFn: listAllDesignRequests,
    enabled: authorized === true,
  });
  const leads = useQuery<LeadRow[]>({
    queryKey: ["admin", "leads"],
    queryFn: listLeads,
    enabled: authorized === true,
  });
  const permits = useQuery<AdminPermitRow[]>({
    queryKey: ["admin", "permits"],
    queryFn: listAllPermits,
    enabled: authorized === true,
  });
  const documents = useQuery<AdminDocumentRow[]>({
    queryKey: ["admin", "documents"],
    queryFn: listAllDocuments,
    enabled: authorized === true,
  });
  const engagements = useQuery<AdminEngagementRow[]>({
    queryKey: ["admin", "engagements"],
    queryFn: listEngagementRequests,
    enabled: authorized === true,
  });
  const aiLogs = useQuery<AiLogRow[]>({
    queryKey: ["admin", "ai-logs"],
    queryFn: listAiLogs,
    enabled: authorized === true && tab === "ai logs",
  });
  const users = useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: listAllUsers,
    enabled: authorized === true,
  });
  const invited = useQuery<InvitedUserRow[]>({
    queryKey: ["admin", "invited"],
    queryFn: listInvitedUsers,
    enabled: authorized === true,
  });
  const auditLog = useQuery<AdminAuditLogRow[]>({
    queryKey: ["admin", "activity"],
    queryFn: listAuditLog,
    enabled: authorized === true && tab === "activity",
  });

  if (authorized !== true) {
    return (
      <div className="container-page py-16 text-sm text-muted-foreground">Checking access…</div>
    );
  }

  const permitRows = permits.data ?? [];
  const openPermits = permitRows.filter((p) => p.status !== "approved");
  const atRiskPermits = openPermits.filter((p) => {
    const age = daysUntil(p.submitted_at ?? p.created_at) ?? 0;
    return -age >= 21; // 21+ days sitting in the same open status
  });
  const expiringPermits = permitRows.filter((p) => {
    if (!p.expiry_date) return false;
    const left = daysUntil(p.expiry_date) ?? 999;
    return left <= 60;
  });
  const visiblePermits =
    permitFilter === "at_risk" ? atRiskPermits : permitFilter === "expiring" ? expiringPermits : permitRows;

  const pendingEngagements = (engagements.data ?? []).filter((e) => e.status === "requested").length;

  return (
    <div className="container-page py-10">
      <span className="badge-soft">Admin</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold">CorvusDP staff console</h1>

      <div className="mt-5 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative rounded-md px-3 py-2 text-sm font-medium capitalize ${
              tab === t
                ? "bg-nav-highlight text-nav-highlight-foreground"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t}
            {t === "engagements" && pendingEngagements > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {pendingEngagements}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "projects" && (
          <Section title={`Permitting projects (${projects.data?.length ?? 0})`}>
            <Table
              cols={["Project", "Jurisdiction", "Feasibility", "Complexity", "Stage", "Created"]}
              rows={(projects.data ?? []).map((p) => [
                p.name ?? p.address ?? "—",
                p.jurisdiction ?? "—",
                <Pill
                  key="f"
                  tone={
                    p.feasibility_status === "allowed"
                      ? "green"
                      : p.feasibility_status === "not_allowed"
                        ? "red"
                        : "amber"
                  }
                >
                  {humanize(p.feasibility_status)}
                </Pill>,
                humanize(p.complexity_level),
                humanize(p.stage),
                dateShort(p.created_at),
              ])}
              loading={projects.isLoading}
            />
          </Section>
        )}

        {tab === "design" && (
          <Section
            title={`Design requests (${design.data?.length ?? 0})`}
            subtitle="Advance a request through concept → development → final drawings once the design team is engaged."
          >
            <Table
              cols={["Location", "Scope", "Sector", "Stage", "Created", ""]}
              rows={(design.data ?? []).map((d) => [
                d.address ?? d.city ?? "—",
                humanize(d.scope),
                humanize(d.sector),
                <Pill key="s" tone={d.stage === "completed" ? "green" : "blue"}>
                  {DESIGN_STAGE_LABEL[d.stage as DesignStage] ?? humanize(d.stage)}
                </Pill>,
                dateShort(d.created_at),
                <DesignStageAction key="a" row={d} onChanged={() => design.refetch()} />,
              ])}
              loading={design.isLoading}
            />
          </Section>
        )}

        {tab === "engagements" && (
          <Section
            title={`Professional-assistance requests (${engagements.data?.length ?? 0})`}
            subtitle="Follow up with a scope of services, fee schedule, and payment schedule."
          >
            <Table
              cols={["Project", "Track", "Requester", "Scope", "Status", "Requested", ""]}
              rows={(engagements.data ?? []).map((e) => [
                e.project_address ?? "—",
                humanize(e.track),
                e.requester_email ?? "—",
                <span key="s" className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
                  {e.scope_summary ?? e.note ?? "—"}
                </span>,
                <Pill
                  key="st"
                  tone={
                    e.status === "completed" ? "green" : e.status === "contacted" ? "blue" : "amber"
                  }
                >
                  {humanize(e.status)}
                </Pill>,
                dateShort(e.created_at),
                <EngagementActions key="a" row={e} onChanged={() => engagements.refetch()} />,
              ])}
              loading={engagements.isLoading}
            />
          </Section>
        )}

        {tab === "permits" && (
          <Section
            title={`Permits across all projects (${permitRows.length})`}
            subtitle="Submission, aging/risk, approval, and expiry tracking in one view."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Open permits" value={<AnimatedNumber value={openPermits.length} />} />
              <Stat
                label="At risk (21+ days, no movement)"
                value={<AnimatedNumber value={atRiskPermits.length} />}
              />
              <Stat
                label="Expiring within 60 days"
                value={<AnimatedNumber value={expiringPermits.length} />}
              />
            </div>
            <div className="mt-4 flex gap-1">
              {(["all", "at_risk", "expiring"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPermitFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                    permitFilter === f
                      ? "bg-nav-highlight text-nav-highlight-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {f.replace("_", " ")}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <Table
                cols={["Project", "Permit", "Status", "Days open", "Expiry", "Reviewer"]}
                rows={visiblePermits.map((p) => {
                  const age = p.status === "approved" ? null : -(daysUntil(p.submitted_at ?? p.created_at) ?? 0);
                  const expiryLeft = p.expiry_date ? daysUntil(p.expiry_date) : null;
                  return [
                    p.project_address ?? "—",
                    p.name,
                    <Pill key="s" tone={p.status === "approved" ? "green" : "amber"}>
                      {humanize(p.status)}
                    </Pill>,
                    age == null ? "—" : `${age}d${age >= 21 ? " ⚠" : ""}`,
                    p.expiry_date
                      ? `${dateShort(p.expiry_date)}${expiryLeft != null && expiryLeft <= 60 ? ` (${expiryLeft}d)` : ""}`
                      : "—",
                    p.current_reviewer ?? "—",
                  ];
                })}
                loading={permits.isLoading}
              />
            </div>
          </Section>
        )}

        {tab === "documents" && (
          <Section
            title={`Documents across all projects (${documents.data?.length ?? 0})`}
            subtitle="Central repository view across every user's project."
          >
            <Table
              cols={["Project", "Name", "Category", "Uploaded", ""]}
              rows={(documents.data ?? []).map((d) => [
                d.project_address ?? "—",
                d.name,
                humanize(d.category),
                dateShort(d.created_at),
                d.storage_path ? <ViewDocumentLink key="v" storagePath={d.storage_path} /> : "—",
              ])}
              loading={documents.isLoading}
            />
          </Section>
        )}

        {tab === "leads" && (
          <Section
            title={`Leads (${leads.data?.length ?? 0})`}
            subtitle="Anonymous drop-offs from the analysis flow, ranked by intent."
          >
            <Table
              cols={["Priority", "Track", "Contact", "Property", "Intent", "Created"]}
              rows={[...(leads.data ?? [])]
                .sort((a, b) => b.intent_score - a.intent_score)
                .map((l) => {
                  const pr = leadPriority(l.intent_score);
                  return [
                    <Pill key="p" tone={pr.tone}>
                      {pr.label}
                    </Pill>,
                    humanize(l.track),
                    l.email ?? l.name ?? "—",
                    (l.property as { address?: string; city?: string } | null)?.address ??
                      (l.property as { city?: string } | null)?.city ??
                      "—",
                    String(l.intent_score),
                    dateShort(l.created_at),
                  ];
                })}
              loading={leads.isLoading}
            />
          </Section>
        )}

        {tab === "ai logs" && (
          <Section
            title={`AI logs (${aiLogs.data?.length ?? 0})`}
            subtitle="Every AI call's real input and output, for review — most recent 200."
          >
            {aiLogs.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (aiLogs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="grid gap-2">
                {(aiLogs.data ?? []).map((log) => (
                  <AiLogEntry key={log.id} log={log} />
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "users" && (
          <Section
            title={`Users (${users.data?.length ?? 0})`}
            subtitle="Every signed-up account. Toggle admin access here — nowhere else can flip it."
          >
            <Table
              cols={["Name", "Email", "Plan", "Referral code", "Joined", "Admin"]}
              rows={(users.data ?? []).map((u) => [
                [u.first_name, u.last_name].filter(Boolean).join(" ") || "—",
                u.email,
                <Pill key="p" tone={u.plan === "free" ? "gray" : "green"}>
                  {humanize(u.plan)}
                </Pill>,
                <span key="r" className="font-mono text-xs">
                  {u.referral_code ?? "—"}
                </span>,
                dateShort(u.created_at),
                <AdminToggle key="a" userRow={u} onChanged={() => users.refetch()} />,
              ])}
              loading={users.isLoading}
            />
          </Section>
        )}

        {tab === "invited" && (
          <Section
            title={`Invited users (${invited.data?.length ?? 0})`}
            subtitle="Staff-sent sign-up invites that haven't converted yet — cleared automatically once that email signs up."
          >
            <InviteForm onSent={() => invited.refetch()} />
            <div className="mt-4">
              <Table
                cols={["Email", "Name", "Invited", "Last sent", "Resends", ""]}
                rows={(invited.data ?? []).map((i) => [
                  i.email,
                  [i.first_name, i.last_name].filter(Boolean).join(" ") || "—",
                  dateShort(i.invited_at),
                  dateShort(i.last_sent_at),
                  String(i.resend_count),
                  <button
                    key="d"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                    onClick={async () => {
                      await deleteInvitedUser(i.id);
                      invited.refetch();
                    }}
                  >
                    Remove
                  </button>,
                ])}
                loading={invited.isLoading}
              />
            </div>
          </Section>
        )}

        {tab === "financials" && (
          <Section
            title="Financials"
            subtitle="Plan distribution from real signed-up accounts. Revenue/MRR will populate here once Stripe checkout is wired up."
          >
            <FinancialsSummary users={users.data ?? []} loading={users.isLoading} />
          </Section>
        )}

        {tab === "activity" && (
          <Section
            title={`Activity log (${auditLog.data?.length ?? 0})`}
            subtitle="Every admin action taken in this console (engagement/design-stage advances, admin-role changes, …)."
          >
            <Table
              cols={["When", "Admin", "Action", "Target", "Detail"]}
              rows={(auditLog.data ?? []).map((a) => [
                dateShort(a.created_at),
                a.actor_email ?? "—",
                humanize(a.action),
                <span key="t" className="font-mono text-xs">
                  {a.target ?? "—"}
                </span>,
                a.detail ?? "—",
              ])}
              loading={auditLog.isLoading}
            />
          </Section>
        )}

        {tab === "settings" && (
          <Section title="Settings" subtitle="Account-wide switches.">
            <p className="text-sm text-muted-foreground">
              Payment mode controls (test/live) will appear here once Stripe checkout is wired up.
              Nothing else is configurable site-wide yet.
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}

function AdminToggle({
  userRow,
  onChanged,
}: {
  userRow: AdminUserRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <button
      className={`text-xs font-semibold underline underline-offset-2 disabled:opacity-50 ${
        userRow.is_admin ? "text-destructive" : "text-accent"
      }`}
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          await setUserIsAdmin(userRow.id, !userRow.is_admin);
          await logAdminAction({
            action: "admin_role_change",
            target: userRow.email,
            detail: userRow.is_admin ? "removed admin" : "made admin",
          });
          onChanged();
        } catch (err) {
          console.error("Could not change admin role:", err);
        } finally {
          setSaving(false);
        }
      }}
    >
      {userRow.is_admin ? "Remove admin" : "Make admin"}
    </button>
  );
}

function InviteForm({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await sendSignupInvite({ email, firstName: firstName || undefined });
      setEmail("");
      setFirstName("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that invite.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
      <div className="min-w-[10rem]">
        <Field label="First name">
          <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
      </div>
      <div className="min-w-[14rem] flex-1">
        <Field label="Email" required>
          <input
            type="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>
      <button className="btn-accent disabled:opacity-60" disabled={sending}>
        {sending ? "Sending…" : "Send invite"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

function FinancialsSummary({ users, loading }: { users: AdminUserRow[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const byPlan = new Map<string, number>();
  for (const u of users) byPlan.set(u.plan, (byPlan.get(u.plan) ?? 0) + 1);
  const paid = users.length - (byPlan.get("free") ?? 0);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total accounts" value={<AnimatedNumber value={users.length} />} />
        <Stat label="Paid accounts" value={<AnimatedNumber value={paid} />} />
        <Stat label="Free accounts" value={<AnimatedNumber value={byPlan.get("free") ?? 0} />} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2 font-medium">Plan</th>
              <th className="px-2 py-2 font-medium">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {[...byPlan.entries()].map(([plan, count]) => (
              <tr key={plan} className="row-hover border-b border-border/60">
                <td className="px-2 py-2">{humanize(plan)}</td>
                <td className="px-2 py-2 tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiLogEntry({ log }: { log: AiLogRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Pill tone="blue">{AI_KIND_LABEL[log.kind] ?? humanize(log.kind)}</Pill>
          <span className="text-xs text-muted-foreground">{dateShort(log.created_at)}</span>
        </span>
        <span className="text-xs font-semibold text-accent">{open ? "Hide" : "View"}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Input
            </div>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-secondary p-2 text-xs">
              {JSON.stringify(log.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Output
            </div>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-secondary p-2 text-xs">
              {JSON.stringify(log.output, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

function DesignStageAction({
  row,
  onChanged,
}: {
  row: AdminDesignRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const next = nextDesignStage(row.stage);
  // Nothing to advance to from "brief" here — that transition is the
  // customer's own "Approve & start detailed design" action, not staff's.
  if (!next || row.stage === "brief") return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <button
      className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        await advanceDesignRequestStage(row.id, next);
        await logAdminAction({
          action: "design_stage_advance",
          target: row.id,
          detail: `${row.stage} → ${next}`,
        });
        setSaving(false);
        onChanged();
      }}
    >
      Advance to {DESIGN_STAGE_LABEL[next]}
    </button>
  );
}

function EngagementActions({
  row,
  onChanged,
}: {
  row: AdminEngagementRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const nextStatus =
    row.status === "requested" ? "contacted" : row.status === "contacted" ? "completed" : null;
  if (!nextStatus) return <span className="text-xs text-muted-foreground">Done</span>;
  return (
    <button
      className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        await updateEngagementStatus(row.id, nextStatus);
        await logAdminAction({
          action: "engagement_status_update",
          target: row.id,
          detail: `${row.status} → ${nextStatus}`,
        });
        setSaving(false);
        onChanged();
      }}
    >
      Mark {humanize(nextStatus)}
    </button>
  );
}

function ViewDocumentLink({ storagePath }: { storagePath: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const url = await getDocumentSignedUrl(storagePath);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
          console.error("Could not open document:", err);
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "Opening…" : "View"}
    </button>
  );
}

function Table({
  cols,
  rows,
  loading,
}: {
  cols: string[];
  rows: React.ReactNode[][];
  loading?: boolean;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            {cols.map((c) => (
              <th key={c} className="px-2 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="list-item-enter row-hover border-b border-border/60"
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
