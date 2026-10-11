import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Team access (public.account_members): an owner invites a property manager
// (works the cases on assigned properties) or a CPA / controller (read-only).
// A member then switches into the owner's account; while they're there the
// app's effective account is the owner's (lib/auth.tsx), and row-level
// security limits what they can read and write.

export type MemberRole = "property_manager" | "cpa";

export const ROLE_LABEL: Record<MemberRole, string> = {
  property_manager: "Property manager",
  cpa: "CPA / controller",
};

export const ROLE_SUMMARY: Record<MemberRole, string> = {
  property_manager:
    "Works the protest cases on the properties you assign: documents, evidence, filing steps and hearing prep. Can't see billing or sign for you.",
  cpa: "Read-only: properties, cases, tax bills, valuations and documents. Can't change anything.",
};

export type TeamMember = {
  id: string;
  email: string;
  role: MemberRole;
  propertyIds: string[] | null; // null = every property
  status: "invited" | "active" | "revoked";
  invitedAt: string;
  acceptedAt: string | null;
};

export type Workspace = {
  ownerId: string;
  ownerName: string;
  role: MemberRole;
  propertyIds: string[] | null;
};

type MemberRow = {
  id: string;
  email: string;
  role: MemberRole;
  property_ids: string[] | null;
  status: TeamMember["status"];
  invited_at: string;
  accepted_at: string | null;
};

export async function listTeam(ownerId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("account_members")
    .select("id, email, role, property_ids, status, invited_at, accepted_at")
    .eq("owner_id", ownerId)
    .neq("status", "revoked")
    .order("invited_at", { ascending: true });
  if (error) throw error;
  return (data as MemberRow[]).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    propertyIds: r.property_ids,
    status: r.status,
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
  }));
}

export async function inviteMember(input: {
  email: string;
  role: MemberRole;
  propertyIds: string[] | null;
}): Promise<{ emailed: boolean; link: string }> {
  return invokeEdgeFunction("invite-account-member", input);
}

export async function updateMember(
  id: string,
  patch: { role?: MemberRole; propertyIds?: string[] | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.role) row.role = patch.role;
  if (patch.propertyIds !== undefined)
    row.property_ids = patch.propertyIds && patch.propertyIds.length ? patch.propertyIds : null;
  const { error } = await supabase.from("account_members").update(row).eq("id", id);
  if (error) throw error;
}

export async function revokeMember(id: string): Promise<void> {
  const { error } = await supabase
    .from("account_members")
    .update({ status: "revoked" })
    .eq("id", id);
  if (error) throw error;
}

// The owner accounts this user has active access to.
export async function listMyWorkspaces(memberId: string): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("account_members")
    .select("owner_id, role, property_ids")
    .eq("member_id", memberId)
    .eq("status", "active");
  if (error) throw error;
  const rows = (data ?? []) as {
    owner_id: string;
    role: MemberRole;
    property_ids: string[] | null;
  }[];
  if (rows.length === 0) return [];
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, company_name, email")
    .in(
      "id",
      rows.map((r) => r.owner_id),
    );
  const nameOf = new Map(
    (
      (owners ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        company_name: string | null;
        email: string | null;
      }[]
    ).map((o) => [
      o.id,
      o.company_name ||
        [o.first_name, o.last_name].filter(Boolean).join(" ") ||
        o.email ||
        "Owner account",
    ]),
  );
  return rows.map((r) => ({
    ownerId: r.owner_id,
    ownerName: nameOf.get(r.owner_id) ?? "Owner account",
    role: r.role,
    propertyIds: r.property_ids,
  }));
}

export async function acceptInvite(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("accept_account_invite", { token });
  if (error) throw error;
  return !!data;
}

// What a member may do in the owner's account — the UI's mirror of the
// row-level security policies.
export function memberCan(workspace: Workspace | null, action: "write" | "billing" | "settings") {
  if (!workspace) return true; // the owner, in their own account
  if (action === "write") return workspace.role === "property_manager";
  return false;
}
