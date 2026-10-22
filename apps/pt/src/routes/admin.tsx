import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Briefcase, Headset, Megaphone, Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkIsAdmin, listAllProtests, type AdminProtestRecord } from "@/lib/admin";
import { getStaffRole } from "@/lib/marketing";
import { getAdminFinancials, type AdminFinancials } from "@/lib/admin-financials";
import { FinancialsTab } from "@/components/admin/RevenueStats";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Super Admin — CorvusPT" }] }),
  component: SuperAdmin,
});

type Accounts = {
  users: number;
  usersNew30: number;
  paying: number;
  ownerManaged: number;
  corvusManaged: number;
  invited: number;
  beta: number;
  appointmentsUpcoming: number;
};
type Stats = {
  accounts: Accounts | null;
  protests: AdminProtestRecord[] | null;
  escalationsOpen: number | null;
  handoffsOpen: number | null;
  mail30: number | null;
  mailUnmatched: number | null;
  leads: number | null;
  leadsNew7: number | null;
  campaignsActive: number | null;
  approvalsPending: number | null;
  transfersPending: number | null;
  unownedCases: number | null;
  unownedTickets: number | null;
  unownedLeads: number | null;
  changes7: number | null;
};

const DASHBOARDS = [
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/support", label: "Customer Support", icon: Headset },
  { to: "/operations", label: "Operations", icon: Briefcase },
] as const;

// The Super Admin's dashboard: high-level statistics only. The detail lives in
// each admin's own dashboard (buttons, top right) and account/role management
// and settings on Manage users & settings. Super Admins only.
function SuperAdmin() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [ok, setOk] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [fin, setFin] = useState<AdminFinancials | null>(null);
  const [finLoading, setFinLoading] = useState(true);
  const [finError, setFinError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/admin-login" });
      return;
    }
    // back from connecting the county mailbox → Operations › County Mail
    if (
      typeof window !== "undefined" &&
      /[?&](mailbox_(connected|error)=|tab=county_mail\b)/.test(window.location.search)
    ) {
      window.location.replace(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/operations${window.location.search}${window.location.search ? "&" : "?"}tab=mail`,
      );
      return;
    }
    checkIsAdmin(user.id)
      .then(async (isAdmin) => {
        if (isAdmin) return setOk(true);
        // other admins have their own dashboards — this one is Super Admin only
        const r = await getStaffRole(user.id).catch(() => null);
        nav({
          to: r?.isOperationsAdmin
            ? "/operations"
            : r?.isMarketingAdmin
              ? "/marketing"
              : r?.isSupportAdmin
                ? "/support"
                : "/admin-login",
        });
      })
      .catch(() => nav({ to: "/admin-login" }));
  }, [loading, user, nav]);

  const load = useCallback(() => {
    const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
      const r = await q;
      return r.error ? null : r.count;
    };
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    setStats(null);
    void Promise.all([
      supabase
        .rpc("marketing_account_summary")
        .then((r) => (r.error ? null : (r.data as Accounts))),
      listAllProtests().catch(() => null),
      count(
        supabase
          .from("support_escalations")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
      ),
      count(
        supabase
          .from("support_handoffs")
          .select("id", { count: "exact", head: true })
          .neq("status", "done"),
      ),
      count(
        supabase
          .from("county_emails")
          .select("id", { count: "exact", head: true })
          .gte("received_at", since30),
      ),
      count(
        supabase
          .from("county_emails")
          .select("id", { count: "exact", head: true })
          .is("property_id", null),
      ),
      count(supabase.from("marketing_leads").select("id", { count: "exact", head: true })),
      count(
        supabase
          .from("marketing_leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since7),
      ),
      count(
        supabase
          .from("marketing_campaigns")
          .select("id", { count: "exact", head: true })
          .in("status", ["approved", "scheduled", "sending"]),
      ),
      count(
        supabase
          .from("approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ),
      count(
        supabase
          .from("record_transfers")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ),
      count(
        supabase
          .from("protests")
          .select("id", { count: "exact", head: true })
          .is("owner_id", null)
          .neq("status", "resolved"),
      ),
      count(
        supabase
          .from("support_escalations")
          .select("id", { count: "exact", head: true })
          .is("assigned_to", null)
          .neq("status", "resolved"),
      ),
      count(
        supabase
          .from("marketing_leads")
          .select("id", { count: "exact", head: true })
          .is("assigned_to", null)
          .is("subscribed_at", null),
      ),
      count(
        supabase
          .from("record_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since7),
      ),
    ]).then(
      ([
        accounts,
        protests,
        escalationsOpen,
        handoffsOpen,
        mail30,
        mailUnmatched,
        leads,
        leadsNew7,
        campaignsActive,
        approvalsPending,
        transfersPending,
        unownedCases,
        unownedTickets,
        unownedLeads,
        changes7,
      ]) =>
        setStats({
          accounts,
          protests,
          escalationsOpen,
          handoffsOpen,
          mail30,
          mailUnmatched,
          leads,
          leadsNew7,
          campaignsActive,
          approvalsPending,
          transfersPending,
          unownedCases,
          unownedTickets,
          unownedLeads,
          changes7,
        }),
    );
    setFinLoading(true);
    setFinError(null);
    getAdminFinancials()
      .then(setFin)
      .catch((e) => setFinError(e instanceof Error ? e.message : "Could not load revenue."))
      .finally(() => setFinLoading(false));
  }, []);
  useEffect(() => {
    if (ok) load();
  }, [ok, load]);

  if (loading || !user || !ok) return null;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const open = stats?.protests?.filter((p) => p.status !== "resolved") ?? null;
  const a = stats?.accounts;
  const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="badge-soft">Super Admin</span>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Super Admin</h1>
          <p className="text-muted-foreground">The business at a glance.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {DASHBOARDS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="btn-outline inline-flex items-center gap-1.5 text-xs"
            >
              <d.icon className="h-3.5 w-3.5" aria-hidden /> {d.label}
            </Link>
          ))}
          <Link to="/admin-manage" className="btn-outline inline-flex items-center gap-1.5 text-xs">
            <Settings2 className="h-3.5 w-3.5" aria-hidden /> Users &amp; settings
          </Link>
          <button type="button" onClick={load} className="btn-outline text-xs">
            Refresh
          </button>
        </div>
      </div>

      <h2 className="mt-8 font-serif text-xl font-semibold">Statistics</h2>
      <StatGroup
        title="Approvals, handoffs & ownership"
        link={{ to: "/admin-manage", label: "Review approvals", search: { tab: "approvals" } }}
        tiles={[
          ["Approvals waiting", n(stats?.approvalsPending)],
          ["Handoffs not yet accepted", n(stats?.transfersPending)],
          [
            "Work with no owner",
            n(
              stats &&
                stats.unownedCases != null &&
                stats.unownedTickets != null &&
                stats.unownedLeads != null
                ? stats.unownedCases + stats.unownedTickets + stats.unownedLeads
                : null,
            ),
            stats?.unownedCases
              ? `${stats.unownedCases} protest case${stats.unownedCases === 1 ? "" : "s"}`
              : undefined,
          ],
          ["Changes recorded (7 days)", n(stats?.changes7)],
        ]}
        loading={!stats}
      />
      <StatGroup
        title="Customers & accounts"
        link={{ to: "/admin-manage", label: "Manage users" }}
        tiles={[
          ["Customers", n(a?.users), a ? `${a.usersNew30} new in 30 days` : undefined],
          ["Paying customers", n(a?.paying)],
          ["Owner Managed", n(a?.ownerManaged)],
          ["CorvusPT Managed", n(a?.corvusManaged)],
          ["Invited, not signed up", n(a?.invited)],
          ["Beta signups", n(a?.beta)],
        ]}
        loading={!stats}
      />
      <StatGroup
        title="Operations"
        link={{ to: "/operations", label: "Open Operations" }}
        tiles={[
          ["Open protest cases", n(open?.length)],
          [
            "Deadlines in 14 days",
            n(
              open?.filter(
                (p) => p.protestDeadline && p.protestDeadline >= today && p.protestDeadline <= soon,
              ).length,
            ),
          ],
          ["Hearings scheduled", n(open?.filter((p) => p.status === "hearing_scheduled").length)],
          ["Upcoming appointments", n(a?.appointmentsUpcoming)],
          [
            "County mail (30 days)",
            n(stats?.mail30),
            stats?.mailUnmatched ? `${stats.mailUnmatched} not matched to a property` : undefined,
          ],
        ]}
        loading={!stats}
      />
      <StatGroup
        title="Support & marketing"
        link={{ to: "/marketing", label: "Open Marketing" }}
        tiles={[
          ["Open support escalations", n(stats?.escalationsOpen)],
          ["New customers to onboard", n(stats?.handoffsOpen)],
          [
            "Marketing leads",
            n(stats?.leads),
            stats?.leadsNew7 != null ? `${stats.leadsNew7} new this week` : undefined,
          ],
          ["Active campaigns", n(stats?.campaignsActive)],
        ]}
        loading={!stats}
      />
      <FinancialsTab
        data={fin}
        loading={finLoading}
        error={finError}
        userCount={a?.users ?? null}
      />
    </div>
  );
}

function StatGroup({
  title,
  link,
  tiles,
  loading,
}: {
  title: string;
  link: {
    to: "/admin-manage" | "/operations" | "/marketing" | "/support";
    label: string;
    search?: { tab: string };
  };
  tiles: [string, string, string?][];
  loading: boolean;
}) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Link
          to={link.to}
          {...(link.search ? { search: link.search as never } : {})}
          className="text-xs text-accent hover:underline"
        >
          {link.label} →
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="card-elev p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{loading ? "…" : value}</div>
            {sub && !loading && <div className="text-xs text-muted-foreground">{sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
