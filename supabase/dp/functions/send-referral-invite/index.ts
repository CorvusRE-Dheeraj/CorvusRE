// Deploy via CLI: `supabase functions deploy send-referral-invite --no-verify-jwt`.
// Requires RESEND_API_KEY.
//
// Any signed-in user can send one of these (not admin-only) — it's the real
// "invite a friend" action on /dashboard/referrals. The referrer's own name
// and referral code are resolved SERVER-SIDE from their own authenticated
// profile row, never trusted from the client, so a caller can only ever
// send an invite carrying their OWN real referral link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmailShell, esc } from "../_shared/email-layout.ts";
import { sendEmail } from "../_shared/resend.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { toEmail, origin } = await req.json();
    if (!toEmail || typeof toEmail !== "string" || !toEmail.includes("@")) {
      throw new Error("A valid email address is required.");
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) return jsonError("unauthenticated", 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile, error: pErr } = await adminClient
      .from("profiles")
      .select("first_name, referral_code")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile?.referral_code) throw new Error("No referral code on file for this account.");

    const base = origin && typeof origin === "string" ? origin : "https://corvusre.com/corvusdp/";
    const referralUrl = `${base}sign-in?ref=${encodeURIComponent(profile.referral_code as string)}`;
    const referrerName = (profile.first_name as string | null) ?? "";
    const email = (toEmail as string).trim().toLowerCase();

    const bodyHtml = `
      <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
        ${
          referrerName
            ? `${esc(referrerName)} thinks CorvusDP could help with your next permitting or design project`
            : "A friend thinks CorvusDP could help with your next permitting or design project"
        } — and referred you directly. CorvusDP turns an address and a project scope into a permitting
        roadmap and a design brief in minutes.
      </p>`;

    const html = renderEmailShell({
      eyebrow: "You were referred",
      heading: referrerName ? `${referrerName} sent you to CorvusDP` : "You've been invited to CorvusDP",
      bodyHtml,
      ctaLabel: "Get started",
      ctaUrl: referralUrl,
      footerNote:
        "This invite was sent by a CorvusDP user who referred you. If you weren't expecting it, you can safely ignore it.",
    });

    await sendEmail({ to: email, subject: `${referrerName || "A friend"} invited you to CorvusDP`, html });

    // Upsert-by-hand: re-inviting the same address bumps sent_at on the
    // existing row instead of erroring on the unique (referrer_id, email)
    // index.
    const { error: upsertErr } = await adminClient
      .from("referral_invites")
      .upsert(
        { referrer_id: user.id, email, sent_at: new Date().toISOString() },
        { onConflict: "referrer_id,email" },
      );
    if (upsertErr) console.error("referral_invites upsert failed (non-blocking):", upsertErr);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("send-referral-invite failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
