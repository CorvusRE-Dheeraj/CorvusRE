import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import {
  getStaffRole,
  loadMarketing,
  markNotificationsRead,
  relDays,
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
    purpose: "Every prospect: portfolios, status, research, segments, Podio and history",
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
  const [bell, setBell] = useState(false);

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

  const unread = data?.notifications.filter((n) => !n.readAt) ?? [];
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
          {data && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setBell((b) => !b)}
                aria-expanded={bell}
                aria-label={`Lead notifications${unread.length ? ` (${unread.length} new)` : ""}`}
                className="btn-outline relative px-2.5 text-sm"
              >
                <Bell className="h-4 w-4" aria-hidden />
                {unread.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                    {unread.length}
                  </span>
                )}
              </button>
              {bell && (
                <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-2 shadow-lg">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-sm font-semibold">For you</span>
                    {unread.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={async () => {
                          await markNotificationsRead(unread.map((n) => n.id)).catch(
                            () => undefined,
                          );
                          await reload();
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {data.notifications.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      Nothing yet. Leads assigned to you show up here when they need action.
                    </p>
                  ) : (
                    <ul className="max-h-80 overflow-y-auto">
                      {data.notifications.slice(0, 30).map((n) => (
                        <li key={n.id}>
                          <button
                            type="button"
                            onClick={async () => {
                              setBell(false);
                              if (!n.readAt)
                                await markNotificationsRead([n.id]).catch(() => undefined);
                              go("leads", n.leadId ? { leadId: n.leadId } : {});
                              void reload();
                            }}
                            className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-secondary/50 ${n.readAt ? "opacity-60" : ""}`}
                          >
                            <span className="block text-sm font-medium">{n.title}</span>
                            {n.detail && (
                              <span className="block text-xs text-muted-foreground">
                                {n.detail}
                              </span>
                            )}
                            <span className="block text-[10px] text-muted-foreground">
                              {relDays(n.createdAt)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
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
          <LeadsCrm data={data} focus={focus} go={go} reload={reload} onAiRun={onAiRun} />
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
