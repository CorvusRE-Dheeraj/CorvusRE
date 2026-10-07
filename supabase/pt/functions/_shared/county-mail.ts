// Pure helpers for the county mailbox (sync-county-mailbox): reading a Gmail API
// message, deciding whether it's county mail, and matching it to a customer's
// property. No Deno/network — apps/pt's vitest tests them (src/lib/county-mail.test.ts).

// ── Gmail message parsing (users.messages.get, format=full) ──────────────────

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

export type ParsedMail = {
  from: string;
  subject: string;
  date: string | null;
  text: string;
  html: string | null;
  attachments: { filename: string; mimeType: string; attachmentId: string; size: number }[];
};

export function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function header(part: GmailPart, name: string): string {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseGmailMessage(payload: GmailPart): ParsedMail {
  let text = "";
  let html: string | null = null;
  const attachments: ParsedMail["attachments"] = [];
  const walk = (p: GmailPart) => {
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size ?? 0,
      });
    } else if (p.mimeType === "text/plain" && p.body?.data && !text) {
      text = decodeBase64Url(p.body.data);
    } else if (p.mimeType === "text/html" && p.body?.data && !html) {
      html = decodeBase64Url(p.body.data);
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(payload);
  if (!text && html) text = (html as string).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    from: header(payload, "From"),
    subject: header(payload, "Subject"),
    date: header(payload, "Date") || null,
    text,
    html,
    attachments,
  };
}

// "Hays CAD <protests@hayscad.com>" -> "hayscad.com"
export function senderDomain(from: string): string | null {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const domain = addr.split("@")[1];
  return domain ? domain.replace(/^www\./, "") : null;
}

// ── Which county a sender is ─────────────────────────────────────────────────

type DirectoryLike = {
  counties: Record<
    string,
    {
      county: string;
      // A few directory entries list only the district's name (no website/email).
      appraisalDistrict: { website?: string | null; email?: string | null } | null;
    }
  >;
};

const hostOf = (v: string): string | null => {
  try {
    return new URL(v.startsWith("http") ? v : `https://${v}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

// Appraisal-district domains (website + contact email) from the Comptroller
// directory -> county name. Shared public-mail domains are never treated as a
// county's own.
const PUBLIC_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"]);

export function countyDomains(directory: DirectoryLike): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of Object.values(directory.counties)) {
    const ad = c.appraisalDistrict;
    if (!ad) continue;
    for (const d of [ad.website ? hostOf(ad.website) : null, ad.email?.split("@")[1]?.toLowerCase() ?? null]) {
      if (d && !PUBLIC_MAIL.has(d)) map.set(d, c.county);
    }
  }
  return map;
}

// A sender at the district's domain or any subdomain of it ("notices.tad.org").
export function countyForDomain(domain: string | null, domains: Map<string, string>): string | null {
  if (!domain) return null;
  for (const [d, county] of domains) {
    if (domain === d || domain.endsWith(`.${d}`)) return county;
  }
  return null;
}

// ── Matching to a customer's property ────────────────────────────────────────

export type MailboxProperty = {
  id: string;
  user_id: string;
  address: string | null;
  account_number: string | null;
  county: string | null; // lower-case county name, from the property's cad
};

export type MailMatch =
  | { kind: "matched"; propertyId: string; userId: string; reason: string }
  | { kind: "county_unmatched"; county: string }
  | { kind: "not_county" };

const digitsOf = (s: string) => s.replace(/\D/g, "");

function streetMatches(hay: string, address: string | null): boolean {
  const m = /^\s*(\d+)\s+([a-z0-9]+)/i.exec(address ?? "");
  if (!m) return false;
  return new RegExp(`\\b${m[1]}\\s+(?:[nsew]\\.?\\s+)?${m[2].toLowerCase()}\\b`).test(hay);
}

// The mailbox gets every kind of mail, for every customer. So:
//  - an account number (6+ digits) quoted in the email identifies the property
//    from any sender — it's specific enough on its own;
//  - a street address only counts when the email is from that county's district
//    (an address alone, from anyone, is too easy to collide);
//  - mail from a district that matches nothing goes to the admin queue;
//  - anything else isn't county mail and is never stored.
export function matchCountyMail(
  mail: { subject: string; text: string },
  senderCounty: string | null,
  properties: MailboxProperty[],
): MailMatch {
  const hay = `${mail.subject}\n${mail.text}`.toLowerCase();
  const digits = digitsOf(hay);

  const byAccount = properties.filter((p) => {
    const acct = digitsOf(p.account_number ?? "");
    return acct.length >= 6 && digits.includes(acct);
  });
  if (byAccount.length === 1) {
    return { kind: "matched", propertyId: byAccount[0].id, userId: byAccount[0].user_id, reason: "account number" };
  }

  if (senderCounty) {
    const inCounty = properties.filter((p) => p.county === senderCounty.toLowerCase());
    const pool = byAccount.length > 1 ? byAccount : inCounty;
    const byStreet = pool.filter((p) => streetMatches(hay, p.address));
    if (byStreet.length === 1) {
      return { kind: "matched", propertyId: byStreet[0].id, userId: byStreet[0].user_id, reason: "address, from the county" };
    }
    return { kind: "county_unmatched", county: senderCounty };
  }

  // Several properties share the quoted number (e.g. one owner, adjoining parcels)
  // — county mail, but a person should pick.
  if (byAccount.length > 1) return { kind: "county_unmatched", county: byAccount[0].county ?? "unknown" };
  return { kind: "not_county" };
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "attachment";
}
