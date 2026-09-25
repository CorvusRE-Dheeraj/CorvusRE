// Deploy via CLI: `supabase functions deploy unsubscribe-notifications --no-verify-jwt`
// (--no-verify-jwt because this is clicked straight out of an email with no
// Supabase session at all — the token in the URL IS the auth, checked
// against profiles.unsubscribe_token below, same pattern as CorvusPT's own
// calendar-feed / unsubscribe-evidence-reminders).
//
// One click, no login: flips a single key in notification_prefs off.
// `kind` says which — "weekly" (send-weekly-digest), "permit_status"
// (send-notification-email's own status-change alerts), or the default
// "email" (the global toggle send-permit-renewal-reminders and every other
// email type ultimately still gate on) — never a client-invented key: only
// these three are accepted, anything else falls back to "email".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VALID_KINDS = new Set(["email", "weekly", "permit_status"]);

const KIND_LABEL: Record<string, string> = {
  email: "all CorvusDP emails",
  weekly: "weekly project update emails",
  permit_status: "permit status update emails",
};

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>${title} — CorvusDP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0; padding:0; background-color:#f4f1ea; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea; padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:16px; padding:32px; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
          <tr><td>
            <h1 style="margin:0 0 12px 0; font-size:20px; color:#16233a;">${title}</h1>
            <p style="margin:0; font-size:14px; line-height:1.6; color:#42506a;">${body}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const kindParam = url.searchParams.get("kind") ?? "email";
  const kind = VALID_KINDS.has(kindParam) ? kindParam : "email";

  if (!token) {
    return page("Link incomplete", "This unsubscribe link is missing its token.", 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, notification_prefs")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (error || !profile) {
    return page(
      "Link expired",
      "This unsubscribe link is no longer valid. You can also manage email preferences any time from CorvusDP under Settings.",
      404,
    );
  }

  const prefs = { ...(profile.notification_prefs ?? {}), [kind]: false };
  await admin.from("profiles").update({ notification_prefs: prefs }).eq("id", profile.id);

  return page(
    "You're unsubscribed",
    `You won't get ${KIND_LABEL[kind]} any more. You can turn them back on any time from CorvusDP under Settings.`,
  );
});
