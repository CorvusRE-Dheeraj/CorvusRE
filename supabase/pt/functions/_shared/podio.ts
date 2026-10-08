// Podio OAuth + API helpers for the podio function. Needs the
// PODIO_CLIENT_ID / PODIO_CLIENT_SECRET secrets (an API key from
// podio.com/settings/api, with the functions domain allowed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const PODIO_API = "https://api.podio.com";

export function podioConfig() {
  const clientId = Deno.env.get("PODIO_CLIENT_ID");
  const clientSecret = Deno.env.get("PODIO_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return {
    configured: !!clientId && !!clientSecret,
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    redirectUri: `${supabaseUrl}/functions/v1/podio`,
    stateSecret: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  };
}

export const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  ref?: { type?: string; id?: number };
};

export async function exchangeToken(
  params: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(`${PODIO_API}/oauth/token/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok)
    throw new Error(
      `Podio token ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as TokenResponse;
}

export async function saveTokens(userId: string, t: TokenResponse) {
  await admin()
    .from("podio_connections")
    .upsert({
      user_id: userId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(
        Date.now() + (t.expires_in - 60) * 1000,
      ).toISOString(),
      podio_user_id: t.ref?.id != null ? String(t.ref.id) : null,
    });
}

// A valid access token for the user, refreshed when it's about to expire.
export async function accessToken(userId: string): Promise<string | null> {
  const { data } = await admin()
    .from("podio_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() > Date.now())
    return data.access_token;
  const cfg = podioConfig();
  const t = await exchangeToken({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: data.refresh_token,
  });
  await saveTokens(userId, t);
  return t.access_token;
}

export async function podioGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${PODIO_API}${path}`, {
    headers: { Authorization: `OAuth2 ${token}` },
  });
  if (!res.ok) throw new Error(`Podio ${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function podioPost<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${PODIO_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth2 ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Podio ${path} ${res.status}`);
  return (await res.json()) as T;
}
