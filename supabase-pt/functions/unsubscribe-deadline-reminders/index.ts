// Deploy via CLI: `supabase functions deploy unsubscribe-deadline-reminders --no-verify-jwt`
// (--no-verify-jwt because this is clicked straight out of an email with no
// Supabase session at all — the token in the URL IS the auth, checked
// against profiles.unsubscribe_token below; same pattern and same token as
// unsubscribe-evidence-reminders, just flipping a different preference key).
//
// One click, no login: turns off deadline/hearing-reminder EMAILS for the
// whole account. SMS isn't touched here on purpose — an email footer link
// only controls the channel that email came through; SMS has its own
// STOP-reply handling once a real provider is wired (see
// send-deadline-reminders' header comment).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>${title} — CorvusPT</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0; padding:0; background-color:#eef2f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f4; padding:32px 16px;">
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
  const token = new URL(req.url).searchParams.get("token");
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
      "This unsubscribe link is no longer valid. You can also turn reminders off any time from CorvusPT under Settings → Notification Preferences.",
      404,
    );
  }

  const prefs = { ...(profile.notification_prefs ?? {}), deadline_reminders_email: false };
  await admin.from("profiles").update({ notification_prefs: prefs }).eq("id", profile.id);

  return page(
    "You're unsubscribed",
    "You won't get any more deadline or hearing-date reminder emails. You can turn them back on any time from CorvusPT under Settings → Notification Preferences.",
  );
});
