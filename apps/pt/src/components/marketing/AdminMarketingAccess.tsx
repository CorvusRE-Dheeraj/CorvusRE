import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import type { AdminUserRecord } from "@/lib/admin";
import {
  setMarketingAdmin,
  setMarketingSupervisor,
  setOperationsAdmin,
  setSupportAdmin,
} from "@/lib/marketing";

// Super Admin control over staff roles: Marketing Admin, Marketing Supervisor,
// Customer Support Admin and Operations Admin. The change is made by a
// database function that only a Super Admin can run, and it's written to the
// Activity Log.
export function AdminMarketingAccess({
  users,
  onChanged,
}: {
  users: AdminUserRecord[];
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !u.isAdmin)
      .filter(
        (u) =>
          !q ||
          [u.email, u.firstName, u.lastName]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          Number(b.isMarketingAdmin || b.isSupportAdmin || b.isOperationsAdmin) -
            Number(a.isMarketingAdmin || a.isSupportAdmin || a.isOperationsAdmin) ||
          (a.email ?? "").localeCompare(b.email ?? ""),
      );
  }, [users, query]);

  async function toggle(
    u: AdminUserRecord,
    role: "marketing" | "support" | "supervisor" | "operations" = "marketing",
  ) {
    const label =
      role === "marketing"
        ? "Marketing Admin"
        : role === "supervisor"
          ? "Marketing Supervisor"
          : role === "operations"
            ? "Operations Admin"
            : "Customer Support Admin";
    const next =
      role === "marketing"
        ? !u.isMarketingAdmin
        : role === "supervisor"
          ? !u.isSupervisor
          : role === "operations"
            ? !u.isOperationsAdmin
            : !u.isSupportAdmin;
    if (
      !(await confirmDialog(
        next ? `Give ${u.email} ${label} access?` : `Remove ${label} access from ${u.email}?`,
      ))
    )
      return;
    setBusyId(u.id);
    try {
      await (role === "marketing"
        ? setMarketingAdmin(u.id, next)
        : role === "supervisor"
          ? setMarketingSupervisor(u.id, next)
          : role === "operations"
            ? setOperationsAdmin(u.id, next)
            : setSupportAdmin(u.id, next));
      toast.success(next ? `${label} access granted.` : `${label} access removed.`);
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not change access."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="card-elev p-4 text-sm">
        <h2 className="font-semibold">What a Marketing Admin can do</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Has access to
            </div>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              <li>Leads &amp; CRM, campaigns, follow-ups</li>
              <li>Corvus AI marketing tools</li>
              <li>Conversion reports and subscription revenue totals</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
              No access to
            </div>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              <li>Customers&apos; protest cases and filings</li>
              <li>Legal documents and uploaded files</li>
              <li>This Admin area (users, plans, settings)</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          * Enforced by the database, not just hidden in the app. Super Admins keep full access to
          everything, including Marketing.
        </p>
        <h2 className="mt-4 font-semibold">What a Marketing Supervisor adds</h2>
        <p className="mt-1 text-muted-foreground">
          Assigns leads, campaigns and follow-ups to the team, approves reassignment
          recommendations, sees team alerts and reviews the marketing audit history.
        </p>
        <h2 className="mt-4 font-semibold">What a Customer Support Admin can do</h2>
        <p className="mt-1 text-muted-foreground">
          Receives every new paying customer from Marketing with an AI summary of their properties,
          subscription, past conversations and onboarding to-dos, and takes over subscription help,
          property onboarding and protest-related support. Marketing keeps the marketing history.
        </p>
        <h2 className="mt-4 font-semibold">What an Operations Admin can do</h2>
        <p className="mt-1 text-muted-foreground">
          Runs the protest work: every customer&apos;s protest cases (status, notes, assigned
          representative, case progress and documents), the county mailbox and appointments. No
          access to users, plans, staff access, Stripe or settings — those stay with Super Admins.
        </p>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search users by email or name…"
        aria-label="Search users"
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="card-elev overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Marketing Admin</th>
              <th className="px-3 py-2 font-medium">Marketing Supervisor</th>
              <th className="px-3 py-2 font-medium">Customer Support Admin</th>
              <th className="px-3 py-2 font-medium">Operations Admin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={u.isMarketingAdmin}
                    aria-label={`Marketing Admin for ${u.email}`}
                    disabled={busyId === u.id}
                    onClick={() => void toggle(u)}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${u.isMarketingAdmin ? "bg-accent" : "bg-secondary"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.isMarketingAdmin ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={u.isSupervisor}
                    aria-label={`Marketing Supervisor for ${u.email}`}
                    disabled={busyId === u.id}
                    onClick={() => void toggle(u, "supervisor")}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${u.isSupervisor ? "bg-accent" : "bg-secondary"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.isSupervisor ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={u.isSupportAdmin}
                    aria-label={`Customer Support Admin for ${u.email}`}
                    disabled={busyId === u.id}
                    onClick={() => void toggle(u, "support")}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${u.isSupportAdmin ? "bg-accent" : "bg-secondary"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.isSupportAdmin ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={u.isOperationsAdmin}
                    aria-label={`Operations Admin for ${u.email}`}
                    disabled={busyId === u.id}
                    onClick={() => void toggle(u, "operations")}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${u.isOperationsAdmin ? "bg-accent" : "bg-secondary"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.isOperationsAdmin ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
