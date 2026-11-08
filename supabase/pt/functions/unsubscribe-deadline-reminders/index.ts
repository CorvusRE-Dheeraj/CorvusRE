// Deploy via CLI: `supabase functions deploy unsubscribe-deadline-reminders --no-verify-jwt`
// (--no-verify-jwt because this is reached straight from an email with no
// Supabase session at all — the token in the URL IS the auth, checked
// against profiles.unsubscribe_token below; same token as
// unsubscribe-evidence-reminders, just flipping a different preference key).
//
// Turns off deadline/hearing-reminder EMAILS (or, with kind=assessment, the
// assessment-change emails from monitor-assessments) for the whole account.
// SMS isn't touched — an email footer link only controls its own channel.
//
// GET (the link in the email): redirects to the app's /reminder-unsubscribe
// page. Supabase serves function HTML as text/plain, so a page rendered here
// showed as raw HTML; and nothing changes on GET, because mail scanners open
// every link in an email. The page shows what will be turned off and the
// owner confirms with a click, which POSTs here:
//   { t, kind?, action: "info" | "unsubscribe" } → { kind, alreadyOff }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appBaseUrl } from "../_shared/app-url.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    const u = new URL(req.url);
    const kind =
      u.searchParams.get("kind") === "assessment" ? "assessment" : "deadline";
    const next = new URL(`${appBaseUrl()}/reminder-unsubscribe`);
    next.searchParams.set("kind", kind);
    next.searchParams.set("t", u.searchParams.get("token") ?? "");
    return Response.redirect(next.toString(), 302);
  }

  const body = (await req.json().catch(() => ({}))) as {
    t?: unknown;
    kind?: unknown;
    action?: unknown;
  };
  const token = typeof body.t === "string" ? body.t.trim() : "";
  const kind = body.kind === "assessment" ? "assessment" : "deadline";
  if (!token) return json({ error: "invalid_link" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, notification_prefs")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (error || !profile) return json({ error: "invalid_link" }, 404);

  const key =
    kind === "assessment"
      ? "assessment_alerts_email"
      : "deadline_reminders_email";
  const prefs = (profile.notification_prefs ?? {}) as Record<string, unknown>;
  if (body.action === "unsubscribe") {
    await admin
      .from("profiles")
      .update({ notification_prefs: { ...prefs, [key]: false } })
      .eq("id", profile.id);
    return json({ kind, alreadyOff: true });
  }
  return json({ kind, alreadyOff: prefs[key] === false });
});
