import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getStaffRole, type StaffRole } from "@/lib/marketing";
import { listTeam, type TeamMember } from "@/lib/bd-console";
import { HandoffInbox, RequestApprovalButton } from "@/components/staff/StaffRecords";
import { useStaffContext } from "@/hooks/use-staff-context";
import { BdDashboard } from "@/components/bd/BdDashboard";
import { BdAccounts } from "@/components/bd/BdAccounts";
import { BdPipeline } from "@/components/bd/BdPipeline";
import { BdResearch } from "@/components/bd/BdResearch";
import { BdPartners } from "@/components/bd/BdPartners";
import { BdFollowups } from "@/components/bd/BdFollowups";
import { BdAnalytics } from "@/components/bd/BdAnalytics";
import { BdSettings } from "@/components/bd/BdSettings";

type Tab =
  | "dashboard"
  | "accounts"
  | "pipeline"
  | "research"
  | "partners"
  | "followups"
  | "analytics"
  | "settings";
const TABS: Tab[] = [
  "dashboard",
  "accounts",
  "pipeline",
  "research",
  "partners",
  "followups",
  "analytics",
  "settings",
];

// Business Development Admin console: strategic accounts, portfolio and
// enterprise opportunities, research, proposals, referral partners and
// follow-ups — on the shared CRM. No access to customers' protest documents,
// payment credentials or platform settings (enforced in the database).
export const Route = createFileRoute("/business-development")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { tab?: Tab; account?: string; opportunity?: string } => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
    account: typeof s.account === "string" ? s.account : undefined,
    opportunity: typeof s.opportunity === "string" ? s.opportunity : undefined,
  }),
  head: () => ({
    meta: [{ title: "Business Development — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  component: BusinessDevelopment,
});

function BusinessDevelopment() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const search = Route.useSearch();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [supervisor, setSupervisor] = useState(false);
  const staffCtx = useStaffContext();
  useEffect(() => {
    if (loading) return;
    if (!user) return void nav({ to: "/admin-login" });
    getStaffRole(user.id)
      .then((r) => (r.isBdAdmin || r.isSuperAdmin ? setRole(r) : nav({ to: "/admin-login" })))
      .catch(() => nav({ to: "/admin-login" }));
  }, [loading, user, nav]);
  useEffect(() => {
    if (!role) return;
    listTeam()
      .then((t) => {
        setTeam(t);
        setSupervisor(role.isSuperAdmin || !!t.find((m) => m.id === user?.id)?.supervisor);
      })
      .catch(() => setTeam([]));
  }, [role, user]);
  if (!role || !user) return null;
  const tab: Tab = search.tab ?? "dashboard";
  const go = (p: { tab: Tab; account?: string; opportunity?: string }) =>
    nav({ to: "/business-development", search: p });
  const tabs: [Tab, string][] = [
    ["dashboard", "Dashboard"],
    ["accounts", "Accounts"],
    ["pipeline", "Pipeline"],
    ["research", "Research"],
    ["partners", "Partners"],
    ["followups", "Follow-ups"],
    ["analytics", "Analytics"],
    ...(role.isSuperAdmin ? ([["settings", "Settings"]] as [Tab, string][]) : []),
  ];
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-soft">Business Development Admin</span>
        {role.isSuperAdmin ? (
          <span className="text-xs text-muted-foreground">Viewing with Super Admin access</span>
        ) : supervisor ? (
          <span className="text-xs text-muted-foreground">Supervisor</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Business Development</h1>
          <p className="text-sm text-muted-foreground">
            Strategic accounts, portfolio opportunities, partnerships, proposals and follow-ups.
          </p>
        </div>
        <RequestApprovalButton ctx={staffCtx} />
      </div>
      <HandoffInbox ctx={staffCtx} />
      <div className="mt-5 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => go({ tab: k })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-accent font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "dashboard" && (
        <BdDashboard
          onOpportunity={(id) => go({ tab: "pipeline", opportunity: id })}
          onAccount={(id) => go({ tab: "accounts", account: id })}
          onTab={(t) => go({ tab: t === "proposals" ? "pipeline" : t })}
        />
      )}
      {tab === "accounts" && (
        <BdAccounts
          team={team}
          openId={search.account ?? null}
          setOpenId={(id) => go({ tab: "accounts", account: id ?? undefined })}
          onOpportunity={(id) => go({ tab: "pipeline", opportunity: id })}
        />
      )}
      {tab === "pipeline" && (
        <BdPipeline
          me={user.id}
          team={team}
          isSupervisor={supervisor}
          openId={search.opportunity ?? null}
          setOpenId={(id) => go({ tab: "pipeline", opportunity: id ?? undefined })}
          onAccount={(id) => go({ tab: "accounts", account: id })}
        />
      )}
      {tab === "research" && (
        <BdResearch onAccount={(id) => go({ tab: "accounts", account: id })} />
      )}
      {tab === "partners" && (
        <BdPartners team={team} onAccount={(id) => go({ tab: "accounts", account: id })} />
      )}
      {tab === "followups" && (
        <BdFollowups
          me={user.id}
          team={team}
          onOpportunity={(id) => go({ tab: "pipeline", opportunity: id })}
          onAccount={(id) => go({ tab: "accounts", account: id })}
        />
      )}
      {tab === "analytics" && (
        <BdAnalytics
          team={team}
          isSupervisor={supervisor}
          onOwner={() => go({ tab: "pipeline" })}
        />
      )}
      {tab === "settings" && role.isSuperAdmin && <BdSettings />}
    </div>
  );
}
