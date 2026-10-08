// Podio for the bulk property import — one function (the project is at its
// edge-function limit), deployed with verify_jwt off because Podio's OAuth
// redirect calls it directly; every POST checks the signed-in user itself.
//
//   GET  ?code&state                    Podio's OAuth redirect: verify the signed
//                                       state, store tokens, send the owner back
//   POST { action: "start", returnPath } → { configured, url? } authorize URL
//   POST { action: "status" }            → { configured, connected }
//   POST { action: "apps" }              → { workspaces }
//   POST { action: "items", appId }      → { headers, rows, total, truncated }
//   POST { action: "disconnect" }        → { ok }
//
// Tokens live in podio_connections (service role only) and never reach the
// browser. Items become a spreadsheet grid (_shared/podio-grid.ts) that runs
// through the same mapping, county matching and duplicate checks as a file.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  accessToken,
  admin,
  exchangeToken,
  podioConfig,
  podioGet,
  podioPost,
  saveTokens,
} from "../_shared/podio.ts";
import {
  itemsToGrid,
  signState,
  verifyState,
  type PodioItem,
} from "../_shared/podio-grid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: corsHeaders });

const APP_ORIGIN = "https://corvusre.com";
const FALLBACK_RETURN = "/corvuspt/dashboard/properties";
// Podio returns at most 500 items per call; a property list rarely needs more.
const PAGE = 500;
const MAX_ITEMS = 2_000;

type Org = { name: string; spaces?: { space_id: number; name: string }[] };
type App = { app_id: number; status?: string; config?: { name?: string } };

const back = (path: string, query: Record<string, string>) => {
  const url = new URL(path, APP_ORIGIN);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });
};

async function oauthCallback(params: URLSearchParams): Promise<Response> {
  const cfg = podioConfig();
  const verified = cfg.configured
    ? await verifyState(params.get("state") ?? "", cfg.stateSecret)
    : null;
  if (!verified) return back(FALLBACK_RETURN, { podio: "error" });
  const code = params.get("code");
  if (params.get("error") || !code)
    return back(verified.returnPath, { podio: "error" });
  try {
    await saveTokens(
      verified.userId,
      await exchangeToken({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: cfg.redirectUri,
      }),
    );
    return back(verified.returnPath, { podio: "connected" });
  } catch {
    return back(verified.returnPath, { podio: "error" });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return oauthCallback(new URL(req.url).searchParams);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    },
  );
  const { data } = await userClient.auth.getUser();
  if (!data.user) return json({ error: "Sign in first." }, 401);
  const userId = data.user.id;
  const body = await req.json().catch(() => ({}));
  const cfg = podioConfig();

  try {
    if (body?.action === "start") {
      if (!cfg.configured) return json({ configured: false });
      const rp = body?.returnPath;
      const returnPath =
        typeof rp === "string" && rp.startsWith("/") && !rp.startsWith("//")
          ? rp
          : FALLBACK_RETURN;
      const url = new URL("https://podio.com/oauth/authorize");
      url.searchParams.set("client_id", cfg.clientId);
      url.searchParams.set("redirect_uri", cfg.redirectUri);
      url.searchParams.set(
        "state",
        await signState(userId, returnPath, cfg.stateSecret),
      );
      return json({ configured: true, url: url.toString() });
    }
    if (body?.action === "disconnect") {
      await admin().from("podio_connections").delete().eq("user_id", userId);
      return json({ ok: true });
    }
    const token = cfg.configured ? await accessToken(userId) : null;
    if (body?.action === "status")
      return json({ configured: cfg.configured, connected: !!token });
    if (!token)
      return json({ error: "Connect your Podio account first." }, 400);

    if (body?.action === "apps") {
      const orgs = await podioGet<Org[]>(token, "/org/");
      const workspaces = [];
      for (const org of orgs)
        for (const space of org.spaces ?? []) {
          const apps = await podioGet<App[]>(
            token,
            `/app/space/${space.space_id}/`,
          ).catch(() => []);
          const active = apps.filter(
            (a) => a.status !== "inactive" && a.status !== "deleted",
          );
          if (active.length)
            workspaces.push({
              org: org.name,
              space: space.name,
              apps: active.map((a) => ({
                appId: a.app_id,
                name: a.config?.name ?? `App ${a.app_id}`,
              })),
            });
        }
      return json({ workspaces });
    }

    if (body?.action === "items") {
      const appId = Number(body.appId);
      if (!appId) return json({ error: "Choose a Podio app." }, 400);
      const items: PodioItem[] = [];
      let total = 0;
      for (let offset = 0; offset < MAX_ITEMS; offset += PAGE) {
        const page = await podioPost<{
          total: number;
          filtered?: number;
          items: PodioItem[];
        }>(token, `/item/app/${appId}/filter/`, { limit: PAGE, offset });
        total = page.filtered ?? page.total;
        items.push(...page.items);
        if (page.items.length < PAGE) break;
      }
      return json({
        ...itemsToGrid(items),
        total,
        truncated: total > items.length,
      });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Podio request failed" },
      502,
    );
  }
});
