// Deploy via CLI: `supabase functions deploy sync-city-code-cases`.
//
// Property Issues auto-fetch: looks up open city code cases at each
// property's address in the public city feeds (Austin Code Enforcement,
// Dallas 311 Code Compliance — see _shared/city-code-cases.ts) and adds any
// new one to property_issues (source 'city_data', status 'new'), with an
// in-app reminder so the owner sees it.
//
// Two callers:
// - a signed-in owner ("Check city records" on the Property Issues tab):
//   their own properties only;
// - pg_cron with the service-role key (daily): every property.
// Existing issues are never changed — a case is only ever added once
// (matched on property_id + external_ref).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest } from "../_shared/service-role-only.ts";
import {
  addressKey,
  caseQuery,
  caseToIssue,
} from "../_shared/city-code-cases.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const LOOKBACK_DAYS = 365;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let userId: string | null = null;
    if (!isServiceRoleRequest(req)) {
      const caller = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: {
            headers: { Authorization: req.headers.get("Authorization") ?? "" },
          },
        },
      );
      const {
        data: { user },
      } = await caller.auth.getUser();
      if (!user) return json({ error: "unauthenticated" }, 401);
      userId = user.id;
    }

    let q = admin.from("properties").select("id, user_id, address");
    if (userId) q = q.eq("user_id", userId);
    const { data: properties, error } = await q;
    if (error) throw error;

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    let checked = 0;
    let added = 0;
    const unsupported: string[] = [];

    for (const p of properties ?? []) {
      const key = addressKey(String(p.address ?? ""));
      if (!key) {
        unsupported.push(p.id);
        continue;
      }
      checked++;
      const { url, params } = caseQuery(key, since);
      const res = await fetch(`${url}?${new URLSearchParams(params)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as Record<string, unknown>[];
      const cases = rows
        .map((r) => caseToIssue(key.city, r))
        .filter((c) => c !== null);
      if (cases.length === 0) continue;

      const { data: existing } = await admin
        .from("property_issues")
        .select("external_ref")
        .eq("property_id", p.id)
        .in(
          "external_ref",
          cases.map((c) => c.externalRef),
        );
      const known = new Set(
        (existing ?? []).map((e) => e.external_ref as string),
      );
      const fresh = cases.filter(
        (c, i) =>
          !known.has(c.externalRef) &&
          cases.findIndex((x) => x.externalRef === c.externalRef) === i,
      );
      if (fresh.length === 0) continue;

      const { data: inserted, error: insError } = await admin
        .from("property_issues")
        .insert(
          fresh.map((c) => ({
            user_id: p.user_id,
            property_id: p.id,
            source: "city_data",
            external_ref: c.externalRef,
            category: c.category,
            title: c.title,
            description: c.description,
            issued_on: c.issuedOn,
            deadline: c.deadline,
            authority: c.authority,
            authority_contact: c.authorityContact,
            status: "new",
          })),
        )
        .select("id, title");
      if (insError) {
        console.error("insert failed", p.id, insError.message);
        continue;
      }
      added += inserted?.length ?? 0;

      // Today's reminder so the new case shows on the Calendar and in the
      // reminder email; its own date reminders follow once the owner opens it.
      const today = new Date().toISOString().slice(0, 10);
      await admin.from("user_reminders").insert(
        (inserted ?? []).map((i) => ({
          user_id: p.user_id,
          property_id: p.id,
          property_issue_id: i.id,
          remind_on: today,
          note: `New city record for your property: ${i.title} — see Property Issues`,
          source: "system",
        })),
      );
    }

    return json({ checked, added, unsupported: unsupported.length });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "unknown error" },
      500,
    );
  }
});
