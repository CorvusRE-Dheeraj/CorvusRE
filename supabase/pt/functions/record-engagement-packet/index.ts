// Deploy via CLI: `supabase functions deploy record-engagement-packet`.
//
// Records a signed-in user's signing of the CorvusPT Engagement Packet — every
// agreement in one place, signed once (see the engagement_packets comment in
// supabase/pt/schema.sql). Written here rather than from the client so the
// consent text and versions stored are the server's canonical copies and the IP /
// user-agent come from the request. Also records the Terms/Privacy acceptance the
// packet includes, fills any blank profile fields from the signer's details, and
// emails the signer their signed documents (../_shared/engagement-packet-email.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AI_ACK_VERSION,
  PACKET_CONSENT_TEXT,
  PACKET_VERSION,
  PRIVACY_VERSION,
  SIGNUP_ACK_VERSION,
  TERMS_VERSION,
} from "../_shared/engagement-packet.ts";
import { SERVICE_AGREEMENT_VERSION } from "../_shared/service-agreement.ts";
import { sendSignedPacketEmail } from "../_shared/engagement-packet-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// A drawn signature is a PNG data URL; cap it so a malformed client can't store
// megabytes per row. A 600x160 canvas export is far below this.
const MAX_SIGNATURE_LENGTH = 400_000;

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.packetVersion !== PACKET_VERSION) {
      return bad("The agreements were updated while you were signing — please reload and try again.", 409);
    }
    const firstName = str(body.firstName);
    const lastName = str(body.lastName);
    const title = str(body.title);
    const role = body.role === "owner" || body.role === "representative" ? body.role : null;
    const companyName = str(body.companyName);
    const phone = str(body.phone);
    const sig = body.signature as { type?: unknown; data?: unknown } | undefined;
    const signatureType = sig?.type === "draw" || sig?.type === "type" ? sig.type : null;
    const signatureData = str(sig?.data);

    if (!firstName || !lastName || !title || !role || !phone) {
      return bad("First name, last name, title, signee role and phone are required.");
    }
    if (role === "representative" && !companyName) {
      return bad("Enter the name of the company or entity you're signing for.");
    }
    if (!signatureType || !signatureData || signatureData.length > MAX_SIGNATURE_LENGTH) {
      return bad("A signature is required.");
    }
    if (signatureType === "draw" && !signatureData.startsWith("data:image/png;base64,")) {
      return bad("A drawn signature must be a PNG image.");
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
    if (userErr || !user) return bad("unauthenticated", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ipAddress =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const userAgent = req.headers.get("user-agent");
    const signedAt = new Date().toISOString();

    const { data: packet, error: insErr } = await admin
      .from("engagement_packets")
      .insert({
        user_id: user.id,
        packet_version: PACKET_VERSION,
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        service_agreement_version: SERVICE_AGREEMENT_VERSION,
        ai_ack_version: AI_ACK_VERSION,
        signee_first_name: firstName,
        signee_last_name: lastName,
        signee_title: title,
        signee_role: role,
        company_name: companyName || null,
        email: user.email ?? null,
        phone,
        signature_type: signatureType,
        signature_data: signatureData,
        consent_text: PACKET_CONSENT_TEXT,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: signedAt,
      })
      .select(
        "id, packet_version, signee_first_name, signee_last_name, signee_title, signee_role, company_name, email, phone, signature_type, signature_data, signed_at",
      )
      .single();
    if (insErr) throw insErr;

    // The packet includes the Terms & Privacy, so it counts as accepting them —
    // LegalGate-era code (termsAcceptanceNeeded) keeps reading terms_acceptances.
    const { error: termsErr } = await admin.from("terms_acceptances").insert({
      user_id: user.id,
      email: user.email ?? null,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      ack_version: SIGNUP_ACK_VERSION,
      ip_address: ipAddress,
      user_agent: userAgent,
      source: "engagement_packet",
    });
    if (termsErr) console.error("terms_acceptances insert failed (packet still recorded):", termsErr);

    // Fill — never overwrite — the profile from the signer's details, so a Google
    // signup with no name on file gets one here.
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, last_name, phone, company_name")
      .eq("id", user.id)
      .maybeSingle();
    const fill: Record<string, string> = {};
    if (!profile?.first_name) fill.first_name = firstName;
    if (!profile?.last_name) fill.last_name = lastName;
    if (!profile?.phone) fill.phone = phone;
    if (!profile?.company_name && companyName) fill.company_name = companyName;
    if (Object.keys(fill).length > 0) {
      await admin.from("profiles").update(fill).eq("id", user.id);
    }

    // "Your signed documents" with a copy attached and the client-portal link.
    // Never throws — the signing above is already recorded either way.
    if (user.email) {
      await sendSignedPacketEmail({
        firstName,
        lastName,
        title,
        role,
        companyName: companyName || null,
        email: user.email,
        phone,
        signatureType,
        signatureData,
        signedAt,
        ipAddress,
        packetVersion: PACKET_VERSION,
      });
    }

    return new Response(JSON.stringify(packet), { status: 200, headers: corsHeaders });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err && typeof err.message === "string"
          ? err.message
          : "unknown error";
    console.error("record-engagement-packet failed:", err);
    return bad(message, 500);
  }
});
