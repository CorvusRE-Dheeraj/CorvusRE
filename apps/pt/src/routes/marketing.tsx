import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import {
  getStaffRole,
  loadMarketing,
  monitor,
  syncLeads,
  type AiRun,
  type MarketingData,
  type StaffRole,
} from "@/lib/marketing";
import { MarketingDashboard } from "@/components/marketing/MarketingDashboard";
import { LeadsCrm } from "@/components/marketing/LeadsCrm";
import { Campaigns } from "@/components/marketing/Campaigns";
import { AiWorkspace } from "@/components/marketing/AiWorkspace";
import { Followups } from "@/components/marketing/Followups";
import { Analytics } from "@/components/marketing/Analytics";
import type { Focus, MarketingTab } from "@/components/marketing/shared";

// Marketing Admin workspace. Open to Marketing Admins and Super Admins; the
// marketing_* tables are the only data it touches (database-enforced — a
// Marketing Admin can't read protest cases, documents or filings anywhere).
export const Route = createFileRoute("/marketing")({
  head: () => ({ meta: [{ title: "Marketing — CorvusPT" }] }),
  component: MarketingPage,
});

const TABS: { key: MarketingTab; label: string; purpose: string }[] = [
  { key: "dashboard", label: "Dashboard", purpose: "The overall picture and what needs you now" },
  {
    key: "leads",
    label: "Leads & CRM",
    purpose: "Prospect profiles, properties, scores and history",
  },
  {
    key: "campaigns",
    label: "Campaigns",
    purpose: "Create, approve, schedule and track email campaigns",
  },
  { key: "ai", label: "AI Marketing", purpose: "Give Corvus AI instructions and review its work" },
  { key: "followups", label: "Follow-ups", purpose: "Overdue, upcoming and AI-planned outreach" },
  { key: "analytics", label: "Analytics", purpose: "Sources, conversion, campaigns and revenue" },
];

function MarketingPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [data, setData] = useState<MarketingData | null>(null);
  const [tab, setTab] = useState<MarketingTab>("dashboard");
  const [focus, setFocus] = useState<Focus>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/admin-login" });
      return;
    }
    getStaffRole(user.id)
      .then((r) => {
        if (!r.isMarketingAdmin && !r.isSuperAdmin) {
          nav({ to: "/admin-login" });
          return;
        }
        setRole(r);
      })
      .catch(() => nav({ to: "/admin-login" }));
  }, [loading, user, nav]);

  const reload = useCallback(async () => {
    setData(await loadMarketing());
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncLeads();
      setLastSync(new Date());
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not refresh the leads."));
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  // Every visit folds in new beta signups / users and current paying status first.
  useEffect(() => {
    if (role) void sync();
  }, [role, sync]);

  const go = useCallback((t: MarketingTab, f: Focus = {}) => {
    setTab(t);
    setFocus({ ...f });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const onAiRun = useCallback((r: AiRun) => {
    setData((d) => (d ? { ...d, aiRuns: [r, ...d.aiRuns] } : d));
  }, []);

  const counts = useMemo(() => {
    if (!data) return {} as Partial<Record<MarketingTab, number>>;
    const now = new Date();
    return {
      dashboard: monitor(data, now).filter((a) => a.severity !== "info").length,
      followups: data.followups.filter((f) => f.status === "pending" && new Date(f.dueAt) < now)
        .length,
    } as Partial<Record<MarketingTab, number>>;
  }, [data]);

  if (!role) return null;
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="badge-soft">
            {role.isSuperAdmin ? "Super Admin" : "Marketing Admin"}
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Marketing</h1>
          <p className="text-sm text-muted-foreground">{current.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role.isSuperAdmin && (
            <Link to="/admin" className="btn-outline text-sm">
              Admin
            </Link>
          )}
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="btn-outline inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
            title="Pull in new beta signups and users, and update who's paying"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>
      {lastSync && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Synced with signups and accounts at {lastSync.toLocaleTimeString()}
        </p>
      )}

      <nav className="mt-5 border-b border-border" aria-label="Marketing sections">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => go(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
              {!!counts[t.key] && (
                <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-5">
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading marketing data…</p>
        ) : tab === "dashboard" ? (
          <MarketingDashboard data={data} go={go} onAiRun={onAiRun} />
        ) : tab === "leads" ? (
          <LeadsCrm data={data} focus={focus} go={go} reload={reload} />
        ) : tab === "campaigns" ? (
          <Campaigns data={data} focus={focus} reload={reload} />
        ) : tab === "ai" ? (
          <AiWorkspace data={data} go={go} reload={reload} onAiRun={onAiRun} />
        ) : tab === "followups" ? (
          <Followups data={data} focus={focus} go={go} reload={reload} />
        ) : (
          <Analytics data={data} onAiRun={onAiRun} />
        )}
      </div>
    </div>
  );
}
