import { supabase } from "./supabase";

// City / municipality portal logins for a project (dashboard → File & track →
// City Portal). The password never travels with these rows: it's stored
// encrypted in Supabase Vault and only set or revealed through the
// set_portal_password / reveal_portal_password functions, which check that
// the caller owns the project or is staff (see schema.sql).
export type PortalLogin = {
  id: string;
  projectId: string;
  portalName: string;
  portalUrl: string | null;
  username: string | null;
  accountRef: string | null;
  notes: string | null;
  hasPassword: boolean;
  updatedAt: string;
};

type Row = {
  id: string;
  project_id: string;
  portal_name: string;
  portal_url: string | null;
  username: string | null;
  account_ref: string | null;
  notes: string | null;
  password_secret_id: string | null;
  updated_at: string;
};

const fromRow = (r: Row): PortalLogin => ({
  id: r.id,
  projectId: r.project_id,
  portalName: r.portal_name,
  portalUrl: r.portal_url,
  username: r.username,
  accountRef: r.account_ref,
  notes: r.notes,
  hasPassword: !!r.password_secret_id,
  updatedAt: r.updated_at,
});

export type PortalLoginInput = {
  portalName: string;
  portalUrl?: string;
  username?: string;
  accountRef?: string;
  notes?: string;
};

// A bare "city.gov/portal" opens as a relative link; give it a scheme.
export function normalizePortalUrl(url: string | undefined): string | null {
  const u = (url ?? "").trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const toColumns = (i: PortalLoginInput) => ({
  portal_name: i.portalName.trim(),
  portal_url: normalizePortalUrl(i.portalUrl),
  username: i.username?.trim() || null,
  account_ref: i.accountRef?.trim() || null,
  notes: i.notes?.trim() || null,
});

export async function listPortalLogins(projectId: string): Promise<PortalLogin[]> {
  const { data, error } = await supabase
    .from("project_portal_logins")
    .select(
      "id, project_id, portal_name, portal_url, username, account_ref, notes, password_secret_id, updated_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

export async function addPortalLogin(
  projectId: string,
  userId: string,
  input: PortalLoginInput,
  password?: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("project_portal_logins")
    .insert({ project_id: projectId, updated_by: userId, ...toColumns(input) })
    .select("id")
    .single();
  if (error) throw error;
  if (password) await setPortalPassword((data as { id: string }).id, password);
}

export async function updatePortalLogin(
  id: string,
  userId: string,
  input: PortalLoginInput,
): Promise<void> {
  const { error } = await supabase
    .from("project_portal_logins")
    .update({ ...toColumns(input), updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePortalLogin(id: string): Promise<void> {
  const { error } = await supabase.from("project_portal_logins").delete().eq("id", id);
  if (error) throw error;
}

// Empty password clears the stored one.
export async function setPortalPassword(id: string, password: string): Promise<void> {
  const { error } = await supabase.rpc("set_portal_password", {
    p_login_id: id,
    p_password: password,
  });
  if (error) throw error;
}

export async function revealPortalPassword(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("reveal_portal_password", { p_login_id: id });
  if (error) throw error;
  return (data as string | null) ?? null;
}
