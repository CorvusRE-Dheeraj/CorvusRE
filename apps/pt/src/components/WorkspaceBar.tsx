import { Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/account-members";

// Team access: which account a property manager or CPA is working in, and a
// switch between their own account and the owners who invited them.
// Rendered at the top of every dashboard page; nothing shows for an owner
// with no memberships.
export function WorkspaceBar() {
  const { workspace, workspaces, setWorkspace } = useAuth();
  if (workspaces.length === 0 && !workspace) return null;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm ${
        workspace ? "border-accent/50 bg-accent/10" : "border-border bg-secondary/40"
      }`}
    >
      <Users className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <label htmlFor="workspace-switch" className="text-muted-foreground">
        Account
      </label>
      <select
        id="workspace-switch"
        value={workspace?.ownerId ?? ""}
        onChange={(e) => setWorkspace(e.target.value || null)}
        className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        <option value="">My own account</option>
        {workspaces.map((w) => (
          <option key={w.ownerId} value={w.ownerId}>
            {w.ownerName} — {ROLE_LABEL[w.role]}
          </option>
        ))}
      </select>
      {workspace && (
        <span className="text-xs text-muted-foreground">
          You&apos;re working in {workspace.ownerName}&apos;s account as{" "}
          {ROLE_LABEL[workspace.role].toLowerCase()}
          {workspace.role === "cpa" ? " — read-only" : ""}
          {workspace.propertyIds
            ? ` · ${workspace.propertyIds.length} assigned propert${workspace.propertyIds.length === 1 ? "y" : "ies"}`
            : ""}
          .
        </span>
      )}
    </div>
  );
}

// Pages that belong to the account holder alone — billing, the owner's own
// settings, referrals and signed agreements.
export const OWNER_ONLY_PATHS = [
  "/dashboard/billing",
  "/dashboard/settings",
  "/dashboard/referrals",
  "/dashboard/agreements",
];

export function OwnerOnlyNotice() {
  const { workspace, setWorkspace } = useAuth();
  return (
    <div className="card-elev mx-auto mt-8 max-w-lg p-6 text-center">
      <h1 className="font-serif text-xl font-semibold">This page is the owner&apos;s</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Billing, settings, referrals and signed agreements belong to {workspace?.ownerName}. Switch
        back to your own account to manage yours.
      </p>
      <button
        type="button"
        onClick={() => setWorkspace(null)}
        className="btn-primary btn-primary-hover mt-4 text-sm"
      >
        Switch to my own account
      </button>
    </div>
  );
}
