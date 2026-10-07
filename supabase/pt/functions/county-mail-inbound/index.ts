// Deploy via CLI: `supabase functions deploy county-mail-inbound --no-verify-jwt`.
// Secrets: RESEND_RECEIVING_API_KEY — a Resend key with Full access (the
// sending key, RESEND_API_KEY, is restricted to sending and can't read received
// mail; it's the fallback only) — and
// RESEND_INBOUND_WEBHOOK_SECRET (the "whsec_…" signing secret of the Resend
// webhook pointed here, event email.received).
//
// County mail via Resend inbound: properties@srclandbuilding.com has a Gmail
// filter that forwards appraisal-district mail to an address on
// inbox.corvusre.com (Resend's receiving domain). Resend posts each received
// email here; we fetch its body and attachments from Resend's Receiving API and
// hand it to the same filing step the Gmail path uses (fileCountyEmail): file
// it under the matching property, or leave it in Admin → County Mail.
//
// No JWT (Resend can't send one) — every request must carry a valid Resend
// (Svix) signature instead, checked before anything else.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySvix } from "../_shared/svix-verify.ts";
import { fileCountyEmail, loadMailboxProperties } from "../_shared/county-mailbox-sync.ts";

const RESEND_API = "https://api.resend.com";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type ReceivedEmail = {
  id: string;
  from: string;
  subject: string | null;
  html: string | null;
  text: string | null;
  created_at: string;
  headers?: Record<string, string>;
  message_id?: string | null;
};

type ReceivedAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  download_url: string;
};

async function resend<T>(path: string): Promise<T> {
  const res = await fetch(`${RESEND_API}${path}`, {
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_RECEIVING_API_KEY") ?? Deno.env.get("RESEND_API_KEY")}`,
    },
  });
  if (!res.ok) throw new Error(`Resend ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.text();
  const ok = await verifySvix(
    Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET") ?? "",
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    body,
  );
  if (!ok) return json({ error: "invalid signature" }, 401);

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  // Only received mail is handled; acknowledge anything else so Resend doesn't retry.
  if (event.type !== "email.received" || !event.data?.email_id) return json({ ignored: true });

  try {
    const emailId = event.data.email_id;
    const email = await resend<ReceivedEmail>(`/emails/receiving/${emailId}`);
    const list = await resend<{ data: ReceivedAttachment[] }>(
      `/emails/receiving/${emailId}/attachments`,
    ).catch(() => ({ data: [] as ReceivedAttachment[] }));

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const properties = await loadMailboxProperties(admin);
    // A filter-forwarded email keeps the district as its From.
    const from = email.headers?.from ?? email.from;
    const outcome = await fileCountyEmail(admin, properties, {
      messageId: `resend:${email.id}`,
      from,
      subject: email.subject ?? "",
      date: email.headers?.date ?? null,
      text: email.text ?? (email.html ? htmlToText(email.html) : ""),
      html: email.html,
      receivedAt: email.created_at,
      attachments: (list.data ?? []).map((a) => ({
        filename: a.filename,
        mimeType: a.content_type || "application/octet-stream",
        size: a.size ?? 0,
        load: async () => {
          const r = await fetch(a.download_url);
          return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
        },
      })),
    });
    return json({ ok: true, outcome });
  } catch (err) {
    console.error("county-mail-inbound failed:", err);
    // 500 so Resend retries a transient failure.
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
