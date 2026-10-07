// Deploy via CLI: `supabase functions deploy county-mail-inbound --no-verify-jwt`.
// Secrets: RESEND_RECEIVING_API_KEY — a Resend key with Full access (the
// sending key, RESEND_API_KEY, is restricted to sending and can't read received
// mail; it's the fallback only) — and
// RESEND_INBOUND_WEBHOOK_SECRET (the "whsec_…" signing secret of the Resend
// webhook pointed here, event email.received).
//
// County mail via Resend inbound: appraisal districts are given CorvusPT's own
// county address (county@inbox.corvusre.com — the agent contact, and copied on
// every county email CorvusPT drafts), so county mail comes straight here, no
// forwarding. Resend posts each received email; we fetch its body and
// attachments from Resend's Receiving API and hand it to the shared filing step
// (fileCountyEmail): file it under the matching property, or leave it in
// Admin → County Mail. Every email kept also sends staff a short notice at
// properties@srclandbuilding.com, so the team still sees county mail.
//
// No JWT (Resend can't send one) — every request must carry a valid Resend
// (Svix) signature instead, checked before anything else.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySvix } from "../_shared/svix-verify.ts";
import {
  fileCountyEmail,
  loadMailboxProperties,
} from "../_shared/county-mailbox-sync.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { loginUrl } from "../_shared/app-url.ts";

const STAFF_EMAIL = "properties@srclandbuilding.com";

// A short heads-up to staff for each county email kept: what it was and where
// it went. Never fails the webhook — the email is already filed.
async function notifyStaff(
  admin: ReturnType<typeof createClient>,
  messageId: string,
): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const { data: row } = await admin
    .from("county_emails")
    .select(
      "subject, from_address, status, county, text_excerpt, property_id, file_names",
    )
    .eq("message_id", messageId)
    .maybeSingle();
  if (!row) return;
  let address: string | null = null;
  if (row.property_id) {
    const { data: p } = await admin
      .from("properties")
      .select("address")
      .eq("id", row.property_id as string)
      .maybeSingle();
    address = (p?.address as string | undefined) ?? null;
  }
  const filed = row.status === "filed";
  const subject = (row.subject as string) || "(no subject)";
  const files = ((row.file_names as string[]) ?? []).filter(
    (n) => !n.startsWith("Email - "),
  );
  const rows = [
    ["From", row.from_address as string],
    ["Subject", subject],
    [
      "Filed under",
      filed
        ? (address ?? "a property")
        : "Needs a property — assign it in County Mail",
    ],
    ...(files.length ? [["Attachments", files.join(", ")]] : []),
    ["Excerpt", ((row.text_excerpt as string) ?? "").slice(0, 300)],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5b6b7f;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const html = emailShell({
    eyebrow: "County mail",
    heading: filed ? `Filed: ${subject}` : `Needs a property: ${subject}`,
    intro: filed
      ? "A county email came in and CorvusPT filed it under the case."
      : "A county email came in that CorvusPT couldn't match to a property.",
    bodyRows: rows,
    ctaLabel: "Open County Mail",
    ctaHref: loginUrl("/admin?tab=county_mail"),
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "CorvusPT <info@corvusre.com>",
      to: [STAFF_EMAIL],
      subject:
        `[County mail] ${filed ? "Filed" : "Needs a property"}: ${subject}`.slice(
          0,
          200,
        ),
      html,
    }),
  });
  if (!res.ok)
    console.error(
      "staff notice failed:",
      res.status,
      (await res.text()).slice(0, 200),
    );
}

const RESEND_API = "https://api.resend.com";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  if (!res.ok)
    throw new Error(
      `Resend ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
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
  if (event.type !== "email.received" || !event.data?.email_id)
    return json({ ignored: true });

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
    const messageId = `resend:${email.id}`;
    const outcome = await fileCountyEmail(
      admin,
      properties,
      {
        messageId,
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
      },
      { keepUnknownSenders: true },
    );
    if (outcome !== "ignored")
      await notifyStaff(admin, messageId).catch((e) => console.error(e));
    return json({ ok: true, outcome });
  } catch (err) {
    console.error("county-mail-inbound failed:", err);
    // 500 so Resend retries a transient failure.
    return json(
      { error: err instanceof Error ? err.message : "unknown error" },
      500,
    );
  }
});
