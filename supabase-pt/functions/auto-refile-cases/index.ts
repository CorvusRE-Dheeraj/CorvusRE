// Deploy via CLI: `supabase functions deploy auto-refile-cases`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer
// auth, is meant to trigger this; same pattern as send-evidence-reminders).
//
// Daily: for every property/BPP account with auto_refile = true (an
// explicit, timestamped opt-in — see the schema.sql comment on these
// columns, and setAutoRefile()/setBppAutoRefile() in src/lib), checks
// whether it has a real resolved case from a prior tax year with no case yet
// for the current tax year — the exact same "canReFile" condition the
// manual Re-file button in properties.tsx already uses — and if so, creates
// a real new protest row automatically (status 'requested', same starting
// state a manually-authorized protest gets). Only for a subject that's
// still actually paid; a lapsed subscription never gets an auto-created
// case, same as property_is_paid()/bpp_is_paid() would block it for a
// manual filing.
//
// Deliberately does NOT skip the real per-filing signature — the customer
// still has to open the case, review, and sign the actual Notice of
// Protest (Form 50-132) themselves once it's ready, same as any other case.
// This only skips having to re-run ProtestAuthorizationFlow's agreement/
// owner-info/AI-ack wizard for a property CorvusPT already represents.
//
// Sends a real confirmation email via Resend once a case is actually
// created (best-effort — a failed email never rolls back the real protest
// row, which has already been created and is real work either way).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type Created = { userId: string; label: string; taxYear: number; kind: "property" | "bpp" };

async function sendConfirmation(
  resendKey: string | undefined,
  to: string,
  label: string,
  taxYear: number,
): Promise<void> {
  if (!resendKey) return;
  try {
    const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
    const html = emailShell({
      eyebrow: "Auto re-file",
      heading: `Your ${taxYear} protest is started`,
      intro:
        `As you authorized, CorvusPT automatically started a new ${taxYear} protest for ` +
        `<strong>${escapeHtml(label)}</strong> — your prior case resolved and this one picks up where it left off.`,
      ctaLabel: "Go to View Case",
      ctaHref: `${appUrl}/dashboard/properties`,
      footnote:
        "Review and sign the Notice of Protest once it's ready. You can turn off auto re-file for this case any time from its Case Progress section.",
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: [to],
        subject: `CorvusPT started your ${taxYear} protest for ${label}`,
        text:
          `As you authorized, CorvusPT automatically started a new ${taxYear} protest for ${label} ` +
          `— your prior case resolved and this one picks up where it left off.\n\n` +
          `Open CorvusPT and go to View Case to review and sign the Notice of Protest once it's ` +
          `ready. You can turn off auto re-file for this case any time from its Case Progress section.`,
        html,
      }),
    });
    if (!res.ok)
      console.error(`Resend ${res.status} for auto-refile confirmation:`, await res.text());
  } catch (err) {
    console.error(
      "Auto-refile confirmation email failed (the case itself was still created):",
      err,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Scheduled job: only pg_cron (service-role key as Bearer auth) may run
  // this. verify_jwt alone lets any signed-in user trigger it across every
  // other user's data -- see ../_shared/service-role-only.ts.
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const admin = createClient(supabaseUrl, serviceKey);

  const currentYear = new Date().getFullYear();
  const created: Created[] = [];
  const failures: { subjectId: string; message: string }[] = [];

  try {
    // ── Properties ──
    const { data: properties, error: propErr } = await admin
      .from("properties")
      .select("id, user_id, address, total_value, subscription_status")
      .eq("auto_refile", true);
    if (propErr) throw propErr;

    for (const property of properties ?? []) {
      try {
        if (property.subscription_status !== "active") continue;

        const { data: propProtests } = await admin
          .from("protests")
          .select("id, status, tax_year")
          .eq("property_id", property.id);
        const hasCurrentYearCase = (propProtests ?? []).some(
          (p) => (p.tax_year ?? 0) >= currentYear,
        );
        if (hasCurrentYearCase) continue;
        const hasResolvedPriorCase = (propProtests ?? []).some(
          (p) => p.status === "resolved" && p.tax_year != null && p.tax_year < currentYear,
        );
        if (!hasResolvedPriorCase) continue;

        const { error: insertErr } = await admin.from("protests").insert({
          user_id: property.user_id,
          property_id: property.id,
          status: "requested",
          tax_year: currentYear,
          original_value: property.total_value,
        });
        if (insertErr) throw insertErr;

        const { data: userData } = await admin.auth.admin.getUserById(property.user_id);
        const to = userData?.user?.email;
        const label = (property.address as string | null) ?? "your property";
        if (to) await sendConfirmation(resendKey, to, label, currentYear);
        created.push({ userId: property.user_id, label, taxYear: currentYear, kind: "property" });
      } catch (err) {
        failures.push({
          subjectId: property.id,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    // ── BPP accounts ──
    const { data: bppAccounts, error: bppErr } = await admin
      .from("bpp_accounts")
      .select("id, user_id, business_name, rendered_value, subscription_status")
      .eq("auto_refile", true);
    if (bppErr) throw bppErr;

    for (const account of bppAccounts ?? []) {
      try {
        if (account.subscription_status !== "active") continue;

        const { data: bppProtests } = await admin
          .from("protests")
          .select("id, status, tax_year")
          .eq("bpp_account_id", account.id);
        const hasCurrentYearCase = (bppProtests ?? []).some(
          (p) => (p.tax_year ?? 0) >= currentYear,
        );
        if (hasCurrentYearCase) continue;
        const hasResolvedPriorCase = (bppProtests ?? []).some(
          (p) => p.status === "resolved" && p.tax_year != null && p.tax_year < currentYear,
        );
        if (!hasResolvedPriorCase) continue;

        const { error: insertErr } = await admin.from("protests").insert({
          user_id: account.user_id,
          bpp_account_id: account.id,
          status: "requested",
          tax_year: currentYear,
          original_value: account.rendered_value,
        });
        if (insertErr) throw insertErr;

        const { data: userData } = await admin.auth.admin.getUserById(account.user_id);
        const to = userData?.user?.email;
        const label = (account.business_name as string | null) ?? "your BPP account";
        if (to) await sendConfirmation(resendKey, to, label, currentYear);
        created.push({ userId: account.user_id, label, taxYear: currentYear, kind: "bpp" });
      } catch (err) {
        failures.push({
          subjectId: account.id,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({
        created: created.length,
        cases: created,
        failed: failures.length,
        failures,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
