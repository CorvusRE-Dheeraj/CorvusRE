// Telnyx SMS for marketing texts. Switched on by setting the secrets:
//   TELNYX_API_KEY        — API key (Mission Control → Keys)
//   TELNYX_FROM           — the sending number in E.164 (+1…), on a messaging
//                           profile with a registered 10DLC / toll-free campaign
//   TELNYX_PUBLIC_KEY     — the account's webhook public key (base64), used to
//                           verify delivery reports and replies
// Until all are set, texts can be written and approved but not sent.

export const smsConfigured = () =>
  !!Deno.env.get("TELNYX_API_KEY") && !!Deno.env.get("TELNYX_FROM") && !!Deno.env.get("TELNYX_PUBLIC_KEY");

export const smsWebhookUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/county-mail-inbound?action=sms`;

/** +1XXXXXXXXXX for a US number, else null. */
export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(to: string, text: string): Promise<{ id: string }> {
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("TELNYX_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("TELNYX_FROM"), to, text, webhook_url: smsWebhookUrl(), use_profile_webhooks: false }),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }; errors?: { detail?: string }[] };
  if (!res.ok || !j.data?.id) throw new Error(`Telnyx ${res.status}: ${j.errors?.[0]?.detail ?? "send failed"}`);
  return { id: j.data.id };
}

/** Verifies Telnyx's ed25519 webhook signature over "<timestamp>|<raw body>" (5-minute window). */
export async function verifyTelnyx(signatureB64: string | null, timestamp: string | null, body: string): Promise<boolean> {
  const pk = Deno.env.get("TELNYX_PUBLIC_KEY");
  if (!pk || !signatureB64 || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const raw = Uint8Array.from(atob(pk), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("Ed25519", key, sig, new TextEncoder().encode(`${timestamp}|${body}`));
  } catch {
    return false;
  }
}

// Carrier-standard keywords.
export const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"];
export const START_WORDS = ["start", "unstop"]; // a "yes" reply is interest, not consent
export const HELP_WORDS = ["help", "info"];
