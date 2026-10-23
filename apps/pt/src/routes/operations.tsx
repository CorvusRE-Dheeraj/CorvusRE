import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getStaffRole, type StaffRole } from "@/lib/marketing";
import {
  listAllProtests,
  updateProtestAssignedRep,
  updateProtestNotes,
  updateProtestStatus,
  toPropertyRecordStub,
  toProtestRecord,
  PROTEST_STATUS_OPTIONS,
  type AdminProtestRecord,
} from "@/lib/admin";
import type { ProtestRecord, ProtestStatus } from "@/lib/protests";
import { ProtestRow } from "@/components/admin/ProtestRow";
import { AdminCaseProgressModal } from "@/components/AdminCaseProgressModal";
import { AdminCountyMailbox } from "@/components/AdminCountyMailbox";
import { AdminAppointments } from "@/components/AdminAppointments";
import { LoadingLine } from "@/components/LoadingLine";

export const Route = createFileRoute("/operations")({
  head: () => ({ meta: [{ title: "Operations — CorvusPT" }] }),
  component: Operations,
});

type Tab = "cases" | "mail" | "appointments";
type Contact = { id: string; email: string | null; name: string | null };
const CLOSED: ProtestStatus[] = ["resolved"];

// Operations Admin dashboard: the protest work — every customer's cases, the
// county mailbox and appointments. Open to Operations Admins and Super
// Admins; database rules give Operations exactly these tables (no users,
// plans, staff access, Stripe or settings — see supabase/pt/operations-admin.sql).
function Operations() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" &&
    /[?&](mailbox_(connected|error)=|tab=mail\b)/.test(window.location.search)
      ? "mail"
      : typeof window !== "undefined" && /[?&]tab=appointments\b/.test(window.location.search)
        ? "appointments"
        : "cases",
  );
  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/admin-login" });
      return;
    }
    getStaffRole(user.id)
      .then((r) => {
        if (!r.isSuperAdmin && !r.isOperationsAdmin) {
          nav({
            to: r.isMarketingAdmin ? "/marketing" : r.isSupportAdmin ? "/support" : "/admin-login",
          });
          return;
        }
        setRole(r);
      })
      .catch(() => nav({ to: "/admin-login" }));
  }, [loading, user, nav]);
  if (!role) return null;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-soft">Operations Admin</span>
        {role.isSuperAdmin && (
          <span className="text-xs text-muted-foreground">Viewing with Super Admin access</span>
        )}
      </div>
      <h1 className="mt-2 font-serif text-3xl font-semibold">Operations</h1>
      <p className="text-sm text-muted-foreground">
        Protest cases, the county mailbox and appointments.
      </p>
      <div className="mt-6 border-b border-border" role="tablist" aria-label="Operations">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["cases", "Cases"],
              ["mail", "County Mail"],
              ["appointments", "Appointments"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === k ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "cases" && <Cases />}
      {tab === "mail" && <AdminCountyMailbox />}
      {tab === "appointments" && <AdminAppointments />}
    </div>
  );
}

function Cases() {
  const [protests, setProtests] = useState<AdminProtestRecord[] | null>(null);
  const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"open" | "all" | ProtestStatus>("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [caseRecord, setCaseRecord] = useState<AdminProtestRecord | null>(null);

  async function load() {
    setError(null);
    try {
      const list = await listAllProtests();
      setProtests(list);
      const ids = [...new Set(list.map((p) => p.userId))];
      if (ids.length) {
        const { data, error: e } = await supabase.rpc("customer_contacts", { p_ids: ids });
        if (e) throw e;
        setContacts(
          new Map(
            (
              (data ?? []) as {
                id: string;
                email: string | null;
                first_name: string | null;
                last_name: string | null;
                company_name: string | null;
              }[]
            ).map((c) => [
              c.id,
              {
                id: c.id,
                email: c.email,
                name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name,
              },
            ]),
          ),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load cases.");
      setProtests([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (protests ?? [])
      .filter((p) =>
        status === "open"
          ? !CLOSED.includes(p.status)
          : status === "all"
            ? true
            : p.status === status,
      )
      .filter((p) => {
        if (!term) return true;
        const c = contacts.get(p.userId);
        return [
          p.propertyAddress,
          p.propertyCad,
          p.accountNumber,
          c?.email,
          c?.name,
          p.assignedRepresentative,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));
      })
      .sort((a, b) => (a.protestDeadline ?? "9999").localeCompare(b.protestDeadline ?? "9999"));
  }, [protests, contacts, q, status]);

  const counts = useMemo(() => {
    const m = new Map<ProtestStatus, number>();
    for (const p of protests ?? []) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return m;
  }, [protests]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  const email = (p: AdminProtestRecord) => contacts.get(p.userId)?.email ?? "";
  async function setStatusFor(p: AdminProtestRecord, s: ProtestStatus) {
    const prev = protests;
    setProtests((cur) => cur?.map((x) => (x.id === p.id ? { ...x, status: s } : x)) ?? null);
    try {
      await updateProtestStatus(p.id, s, {
        propertyAddress: p.propertyAddress,
        requesterEmail: email(p),
      });
      toast.success("Protest status updated.");
    } catch (e) {
      setProtests(prev);
      toast.error(e instanceof Error ? e.message : "Could not update the status.");
    }
  }

  if (!protests) return <LoadingLine text="Loading cases…" className="mt-8 text-sm" />;
  return (
    <section className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Open cases", (protests ?? []).filter((p) => !CLOSED.includes(p.status)).length],
          [
            "Deadline in 14 days",
            (protests ?? []).filter(
              (p) =>
                !CLOSED.includes(p.status) &&
                p.protestDeadline &&
                p.protestDeadline >= today &&
                p.protestDeadline <= soon,
            ).length,
          ],
          ["Hearing scheduled", counts.get("hearing_scheduled") ?? 0],
          ["Resolved", counts.get("resolved") ?? 0],
        ].map(([label, n]) => (
          <div key={label as string} className="card-elev p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search address, account, customer or representative…"
          aria-label="Search cases"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Case status"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="open">Open cases</option>
          <option value="all">All cases</option>
          {PROTEST_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({counts.get(o.value) ?? 0})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void load()} className="btn-outline text-sm">
          Refresh
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases match.</p>
      ) : (
        <div className="grid gap-3">
          {shown.map((p, i) => {
            const c = contacts.get(p.userId);
            const late =
              p.protestDeadline && p.protestDeadline < today && !CLOSED.includes(p.status);
            return (
              <div key={p.id}>
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {c?.name || c?.email || "Customer"}
                  </span>
                  {c?.name && c.email && <span>{c.email}</span>}
                  {p.protestDeadline && (
                    <span className={late ? "font-semibold text-destructive" : ""}>
                      · protest deadline {p.protestDeadline}
                      {late ? " (passed)" : ""}
                    </span>
                  )}
                </div>
                <ProtestRow
                  record={p}
                  requesterEmail={c?.email ?? ""}
                  expanded={expanded === p.id}
                  onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)}
                  onStatusChange={(s) => void setStatusFor(p, s)}
                  onNotesChange={async (notes) => {
                    setProtests(
                      (cur) => cur?.map((x) => (x.id === p.id ? { ...x, notes } : x)) ?? null,
                    );
                    await updateProtestNotes(p.id, notes, {
                      propertyAddress: p.propertyAddress,
                      requesterEmail: email(p),
                    });
                  }}
                  onAssignedRepChange={async (rep) => {
                    await updateProtestAssignedRep(p.id, rep, {
                      propertyAddress: p.propertyAddress,
                      requesterEmail: email(p),
                    });
                    const t = rep.trim();
                    setProtests(
                      (cur) =>
                        cur?.map((x) =>
                          x.id === p.id
                            ? {
                                ...x,
                                assignedRepresentative: t || null,
                                assignedRepSetAt: t ? new Date().toISOString() : null,
                              }
                            : x,
                        ) ?? null,
                    );
                  }}
                  onOpenCase={() => setCaseRecord(p)}
                  delayMs={Math.min(i * 30, 240)}
                />
              </div>
            );
          })}
        </div>
      )}
      {caseRecord && (
        <AdminCaseProgressModal
          userId={caseRecord.userId}
          protest={toProtestRecord(caseRecord)}
          property={toPropertyRecordStub(caseRecord)}
          onUpdate={(patch: Partial<Omit<ProtestRecord, "propertyId" | "bppAccountId">>) => {
            setCaseRecord((prev) =>
              prev && prev.id === caseRecord.id ? { ...prev, ...patch } : prev,
            );
            setProtests(
              (cur) => cur?.map((x) => (x.id === caseRecord.id ? { ...x, ...patch } : x)) ?? null,
            );
          }}
          onClose={() => setCaseRecord(null)}
        />
      )}
    </section>
  );
}
