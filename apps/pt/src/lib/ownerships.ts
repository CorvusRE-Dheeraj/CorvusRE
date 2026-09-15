import { supabase } from "./supabase";

export type OwnershipRole = "owner" | "agent" | "property_manager";

export type OwnershipRecord = {
  id: string;
  name: string;
  role: OwnershipRole;
  createdAt: string;
};

type OwnershipRow = {
  id: string;
  name: string;
  role: OwnershipRole;
  created_at: string;
};

function fromRow(row: OwnershipRow): OwnershipRecord {
  return { id: row.id, name: row.name, role: row.role, createdAt: row.created_at };
}

const SELECT_COLUMNS = "id, name, role, created_at";

export async function listOwnerships(userId: string): Promise<OwnershipRecord[]> {
  const { data, error } = await supabase
    .from("ownerships")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as OwnershipRow[]).map(fromRow);
}

// No dedup here (unlike addProperty) — adding the same ownership name twice,
// possibly under a different role, is a real and harmless thing a user might
// do (e.g. re-searching it later to catch new county records).
export async function addOwnership(
  userId: string,
  ownership: { name: string; role: OwnershipRole },
): Promise<OwnershipRecord> {
  const { data, error } = await supabase
    .from("ownerships")
    .insert({ user_id: userId, name: ownership.name, role: ownership.role })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as OwnershipRow);
}
