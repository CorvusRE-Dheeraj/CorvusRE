// Deploy via CLI: `supabase functions deploy unsubscribe-evidence-reminders --no-verify-jwt`
// (--no-verify-jwt because this is reached straight from an email with no
// Supabase session at all — the token in the URL IS the auth, checked
// against profiles.unsubscribe_token below, same pattern as calendar-feed's
// own token).
//
// Turns off evidence-reminder emails for the whole account — both the stored
// preference (so any future case defaults to off too) and every existing
// 'evidence' protest_form_submissions row (so send-evidence-reminders, which
// reads that row-level field, stops sending immediately).
//
// GET (the link in the email): redirects to the app's /reminder-unsubscribe
// page — see unsubscribe-deadline-reminders for why (raw-HTML page, mail
// scanners). The page POSTs { t, action: "info" | "unsubscribe" } here.
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
    const next = new URL(`${appBaseUrl()}/reminder-unsubscribe`);
    next.searchParams.set("kind", "evidence");
    next.searchParams.set(
      "t",
      new URL(req.url).searchParams.get("token") ?? "",
    );
    return Response.redirect(next.toString(), 302);
  }

  const body = (await req.json().catch(() => ({}))) as {
    t?: unknown;
    action?: unknown;
  };
  const token = typeof body.t === "string" ? body.t.trim() : "";
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

  const prefs = (profile.notification_prefs ?? {}) as Record<string, unknown>;
  if (body.action === "unsubscribe") {
    await admin
      .from("profiles")
      .update({ notification_prefs: { ...prefs, evidence_reminders: "off" } })
      .eq("id", profile.id);
    await admin
      .from("protest_form_submissions")
      .update({ reminder_frequency: "off" })
      .eq("user_id", profile.id)
      .eq("form_type", "evidence");
    return json({ kind: "evidence", alreadyOff: true });
  }
  return json({
    kind: "evidence",
    alreadyOff: prefs.evidence_reminders === "off",
  });
});
