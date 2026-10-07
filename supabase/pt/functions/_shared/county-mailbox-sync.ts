// County mail into CorvusPT. Two ways in, one filing step (fileCountyEmail):
//  - Resend inbound (county-mail-inbound): properties@ forwards county mail to
//    an inbox.corvusre.com address; Resend posts each email to us. The live path.
//  - Gmail read-only (sync-county-mailbox + public.county_mailbox): paused —
//    Gmail read access needs Google's restricted-scope approval.
// Either way: keep only county mail (./county-mail.ts), save the email and its
// attachments, and file them as documents under the matching customer's
// property — or leave them in the admin queue.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import directory from "./tx-cad-directory.json" with { type: "json" };
import { getAccessToken } from "./google-calendar-sync.ts";
import { escapeHtml } from "./email-shell.ts";
import {
  countyDomains,
  countyForDomain,
  gmailConfirmationCode,
  isGmailForwardingConfirmation,
  matchCountyMail,
  parseGmailMessage,
  safeFileName,
  senderDomain,
  withKnownDistricts,
  type GmailPart,
  type MailboxProperty,
} from "./county-mail.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES_PER_PASS = 100;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Same string as COUNTY_EMAIL_DOCUMENT_TYPE in apps/pt/src/lib/county-email.ts.
export const COUNTY_EMAIL_DOCUMENT_TYPE = "County Email";

const DOMAINS = withKnownDistricts(
  countyDomains(directory as Parameters<typeof countyDomains>[0]),
);

// "Dallas Central Appraisal District" -> "dallas" (same rule as the app's countyFromCad).
function countyFromCad(cad: string | null): string | null {
  if (!cad) return null;
  const n = cad.replace(/\b(central\s+)?appraisal\s+district\b/i, "").replace(/\bcounty\b/i, "").trim().toLowerCase();
  return n || null;
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function base64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export type SyncResult = { checked: number; filed: number; queued: number; ignored: number };

export async function syncCountyMailbox(admin: SupabaseClient): Promise<SyncResult> {
  const { data: box } = await admin
    .from("county_mailbox")
    .select("refresh_token, last_checked_at")
    .eq("id", true)
    .maybeSingle();
  if (!box) throw new Error("County mailbox isn't connected.");

  const startedAt = new Date();
  try {
    const token = await getAccessToken(box.refresh_token as string);
    // An hour of overlap so nothing slips between passes; already-seen
    // messages are skipped by message id.
    const since = box.last_checked_at
      ? Math.floor(new Date(box.last_checked_at as string).getTime() / 1000) - 3600
      : Math.floor(startedAt.getTime() / 1000) - 14 * 24 * 3600;
    const q = encodeURIComponent(`after:${since} -in:sent -in:drafts -in:chats -in:spam -in:trash`);
    const list = await gmail<{ messages?: { id: string }[] }>(
      token,
      `/messages?q=${q}&maxResults=${MAX_MESSAGES_PER_PASS}`,
    );
    const ids = (list.messages ?? []).map((m) => m.id);

    const { data: seen } = ids.length
      ? await admin.from("county_emails").select("message_id").in("message_id", ids)
      : { data: [] };
    const seenIds = new Set((seen ?? []).map((r) => r.message_id as string));

    const properties = await loadMailboxProperties(admin);

    const result: SyncResult = { checked: 0, filed: 0, queued: 0, ignored: 0 };
    for (const id of ids) {
      if (seenIds.has(id)) continue;
      result.checked++;
      const msg = await gmail<{ id: string; internalDate?: string; payload: GmailPart }>(
        token,
        `/messages/${id}?format=full`,
      );
      const mail = parseGmailMessage(msg.payload);
      const outcome = await fileCountyEmail(admin, properties, {
        messageId: id,
        from: mail.from,
        subject: mail.subject,
        date: mail.date,
        text: mail.text,
        html: mail.html,
        receivedAt: msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : startedAt.toISOString(),
        attachments: mail.attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          load: async () => {
            const att = await gmail<{ data?: string }>(
              token,
              `/messages/${id}/attachments/${a.attachmentId}`,
            );
            return att.data ? base64UrlToBytes(att.data) : null;
          },
        })),
      });
      result[outcome]++;
    }

    await admin
      .from("county_mailbox")
      .update({ last_checked_at: startedAt.toISOString(), last_error: null })
      .eq("id", true);
    return result;
  } catch (err) {
    await admin
      .from("county_mailbox")
      .update({ last_error: err instanceof Error ? err.message.slice(0, 500) : "unknown error" })
      .eq("id", true);
    throw err;
  }
}

export async function loadMailboxProperties(admin: SupabaseClient): Promise<MailboxProperty[]> {
  const { data: props } = await admin
    .from("properties")
    .select("id, user_id, address, account_number, cad");
  return (props ?? []).map((p) => ({
    id: p.id as string,
    user_id: p.user_id as string,
    address: p.address as string | null,
    account_number: p.account_number as string | null,
    county: countyFromCad(p.cad as string | null),
  }));
}

export type IncomingCountyEmail = {
  messageId: string; // unique per email — dedupes repeat deliveries
  from: string;
  subject: string;
  date: string | null;
  text: string;
  html: string | null;
  receivedAt: string;
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    load: () => Promise<Uint8Array | null>;
  }[];
};

// Match one email, save it (and its attachments) to storage, and either file it
// as documents under the matched property or leave it in the admin queue.
// Non-county mail is never stored. Already-seen emails are skipped.
export async function fileCountyEmail(
  admin: SupabaseClient,
  properties: MailboxProperty[],
  mail: IncomingCountyEmail,
  // A dedicated address only counties are given (county-mail-inbound): an
  // unrecognized sender is still kept for staff rather than dropped — the
  // district may write from a domain the matcher doesn't know.
  opts: { keepUnknownSenders?: boolean } = {},
): Promise<"filed" | "queued" | "ignored"> {
  const { data: seen } = await admin
    .from("county_emails")
    .select("id")
    .eq("message_id", mail.messageId)
    .maybeSingle();
  if (seen) return "ignored";
  const subject = mail.subject.trim() || "(no subject)";

  // Gmail's forwarding confirmation: keep it in the admin queue so the code
  // reaches whoever is setting up the forward. Nothing else from it is stored.
  if (isGmailForwardingConfirmation(mail.from)) {
    const code = gmailConfirmationCode(subject, mail.text);
    await admin.from("county_emails").insert({
      message_id: mail.messageId,
      from_address: mail.from,
      subject,
      text_excerpt: code
        ? `Gmail forwarding confirmation code: ${code}`
        : `${subject} ${mail.text}`.replace(/\s+/g, " ").slice(0, 500),
      received_at: mail.receivedAt,
      county: "Gmail forwarding confirmation",
      status: "needs_property",
    });
    return "queued";
  }

  const senderCounty = countyForDomain(senderDomain(mail.from), DOMAINS);
  const found = matchCountyMail({ subject: mail.subject, text: mail.text }, senderCounty, properties);
  if (found.kind === "not_county" && !opts.keepUnknownSenders) return "ignored";
  const match =
    found.kind === "not_county"
      ? ({ kind: "county_unmatched", county: "unknown sender" } as const)
      : found;

  const owner = match.kind === "matched" ? match.userId : null;
  const safeId = mail.messageId.replace(/[^\w.-]+/g, "_");
  const folder = owner ? `${owner}/inbound/${safeId}` : `county-mailbox/${safeId}`;

  const saved = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body>
<p><strong>From:</strong> ${escapeHtml(mail.from)}<br><strong>Subject:</strong> ${escapeHtml(subject)}<br><strong>Received:</strong> ${escapeHtml(mail.date ?? mail.receivedAt)}</p><hr>${
    mail.html ?? `<pre style="white-space:pre-wrap">${escapeHtml(mail.text)}</pre>`
  }</body></html>`;
  const paths: string[] = [];
  const names: string[] = [];
  const emailName = `Email - ${safeFileName(subject)}.html`;
  const up = await admin.storage
    .from("documents")
    .upload(`${folder}/${emailName}`, new Blob([saved], { type: "text/html" }), {
      contentType: "text/html",
      upsert: true,
    });
  if (up.error) throw up.error;
  paths.push(`${folder}/${emailName}`);
  names.push(emailName);

  for (const a of mail.attachments) {
    if (a.size > MAX_ATTACHMENT_BYTES) continue;
    const bytes = await a.load().catch(() => null);
    if (!bytes) continue;
    const name = safeFileName(a.filename);
    const r = await admin.storage
      .from("documents")
      .upload(`${folder}/${name}`, new Blob([bytes as BlobPart], { type: a.mimeType }), {
        contentType: a.mimeType,
        upsert: true,
      });
    if (!r.error) {
      paths.push(`${folder}/${name}`);
      names.push(name);
    }
  }

  const documentIds: string[] = [];
  if (match.kind === "matched") {
    for (let i = 0; i < paths.length; i++) {
      const { data: doc } = await admin
        .from("documents")
        .insert({
          property_id: match.propertyId,
          user_id: match.userId,
          file_name: names[i],
          storage_path: paths[i],
          document_type: COUNTY_EMAIL_DOCUMENT_TYPE,
          source: "email",
        })
        .select("id")
        .single();
      if (doc) documentIds.push(doc.id as string);
    }
  }

  await admin.from("county_emails").insert({
    message_id: mail.messageId,
    from_address: mail.from,
    subject,
    text_excerpt: `${subject} ${mail.text}`.replace(/\s+/g, " ").slice(0, 500),
    received_at: mail.receivedAt,
    county: match.kind === "matched" ? null : match.county,
    user_id: owner,
    property_id: match.kind === "matched" ? match.propertyId : null,
    status: match.kind === "matched" ? "filed" : "needs_property",
    match_reason: match.kind === "matched" ? match.reason : null,
    file_paths: paths,
    file_names: names,
    document_ids: documentIds,
  });
  return match.kind === "matched" ? "filed" : "queued";
}

// Admin assigns a queued county email to a property: moves its files into the
// owner's folder (so they can open them) and files them as documents.
export async function assignCountyEmail(
  admin: SupabaseClient,
  emailId: string,
  propertyId: string,
): Promise<void> {
  const { data: email } = await admin
    .from("county_emails")
    .select("id, message_id, status, file_paths, file_names")
    .eq("id", emailId)
    .maybeSingle();
  if (!email) throw new Error("Email not found.");
  if (email.status === "filed") throw new Error("This email is already filed.");
  const { data: prop } = await admin.from("properties").select("id, user_id").eq("id", propertyId).maybeSingle();
  if (!prop) throw new Error("Property not found.");

  const owner = prop.user_id as string;
  const newPaths: string[] = [];
  const documentIds: string[] = [];
  const names = (email.file_names as string[]) ?? [];
  for (const [i, from] of ((email.file_paths as string[]) ?? []).entries()) {
    const to = `${owner}/inbound/${email.message_id}/${from.split("/").pop()}`;
    const moved = await admin.storage.from("documents").move(from, to);
    if (moved.error) throw moved.error;
    newPaths.push(to);
    const { data: doc } = await admin
      .from("documents")
      .insert({
        property_id: propertyId,
        user_id: owner,
        file_name: names[i] ?? to.split("/").pop(),
        storage_path: to,
        document_type: COUNTY_EMAIL_DOCUMENT_TYPE,
        source: "email",
      })
      .select("id")
      .single();
    if (doc) documentIds.push(doc.id as string);
  }

  await admin
    .from("county_emails")
    .update({
      user_id: owner,
      property_id: propertyId,
      status: "filed",
      match_reason: "assigned by staff",
      file_paths: newPaths,
      document_ids: documentIds,
    })
    .eq("id", emailId);
}
