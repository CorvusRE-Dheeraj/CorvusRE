// Invites a property manager or CPA / controller to the signed-in owner's
// account (see public.account_members in schema.sql), and emails them a link
// to accept. The invite row is written with the OWNER's own token, so row
// level security guarantees it's their account; the email link carries a
// one-time token that only works for the invited email address.
//
// POST { email, role: "property_manager" | "cpa", propertyIds: string[] | null, resend?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const ROLE_LABEL = {
  property_manager: "Property manager",
  cpa: "CPA / controller",
} as const;
const ROLE_SCOPE = {
  property_manager:
    "work the protest cases for the properties you're assigned — documents, evidence, filing steps and hearing prep",
  cpa: "view the properties, cases, tax bills, valuations and documents (read-only)",
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asOwner = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
      },
    );
    const { data: me } = await asOwner.auth.getUser();
    if (!me.user) return json({ error: "Sign in first." }, 401);

    const body = await req.json();
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const role =
      body?.role === "cpa"
        ? "cpa"
        : body?.role === "property_manager"
          ? "property_manager"
          : null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ error: "Enter a valid email." }, 400);
    if (!role) return json({ error: "Choose a role." }, 400);
    if (email === me.user.email?.toLowerCase())
      return json({ error: "That's your own email." }, 400);
    const propertyIds: string[] | null = Array.isArray(body?.propertyIds)
      ? body.propertyIds.filter((x: unknown) => typeof x === "string")
      : null;

    // Only the owner's own properties can be assigned.
    if (propertyIds && propertyIds.length) {
      const { data: owned } = await asOwner
        .from("properties")
        .select("id")
        .eq("user_id", me.user.id)
        .in("id", propertyIds);
      if ((owned ?? []).length !== propertyIds.length)
        return json(
          { error: "Some of those properties aren't in your account." },
          400,
        );
    }

    const { data: row, error } = await asOwner
      .from("account_members")
      .upsert(
        {
          owner_id: me.user.id,
          email,
          role,
          property_ids: propertyIds && propertyIds.length ? propertyIds : null,
          status: "invited",
          member_id: null,
          accepted_at: null,
          invited_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,email" },
      )
      .select("id, invite_token")
      .single();
    if (error || !row)
      return json(
        { error: error?.message ?? "Could not create the invite." },
        400,
      );

    const { data: profile } = await asOwner
      .from("profiles")
      .select("first_name, last_name, company_name")
      .eq("id", me.user.id)
      .maybeSingle();
    const ownerName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      me.user.email ||
      "A CorvusPT owner";
    const company = profile?.company_name ? ` (${profile.company_name})` : "";
    const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
    const link = `${appUrl}/accept-invite?token=${row.invite_token}`;
    const scope =
      propertyIds && propertyIds.length
        ? `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`
        : "all of their properties";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    let emailed = false;
    if (resendKey) {
      const html = emailShell({
        eyebrow: "Team access",
        heading: `${escapeHtml(ownerName)} invited you to CorvusPT`,
        intro: `${escapeHtml(ownerName)}${escapeHtml(company)} added you as <strong>${ROLE_LABEL[role]}</strong> on their CorvusPT property tax account, for ${escapeHtml(scope)}. You'll be able to ${ROLE_SCOPE[role]}.`,
        ctaLabel: "Accept the invitation",
        ctaHref: link,
        footnote: `Sign in (or create a free account) with ${escapeHtml(email)} to accept. If you weren't expecting this, you can ignore it.`,
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "CorvusPT <info@corvusre.com>",
          to: [email],
          subject: `${ownerName} invited you to their CorvusPT account`,
          html,
          text: `${ownerName}${company} added you as ${ROLE_LABEL[role]} on their CorvusPT account, for ${scope}. You'll be able to ${ROLE_SCOPE[role]}.\n\nAccept: ${link}\n\nSign in or create a free account with ${email} to accept.`,
        }),
      });
      emailed = res.ok;
    }
    return json({ id: row.id, emailed, link });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "unknown error" },
      500,
    );
  }
});
