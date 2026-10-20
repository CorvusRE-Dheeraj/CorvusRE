// Open + click tracking for MARKETING email only (campaigns and follow-ups) —
// transactional email (deadline reminders, receipts) is never touched. An
// invisible pixel and redirect links point at county-mail-inbound
// ?action=track (a public endpoint, since email clients can't sign in). Click
// links carry an HMAC so the redirect can't be abused to send people anywhere.

const base = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/county-mail-inbound`;
// its own secret, so rotating the service key doesn't break links already sent
const secret = () => Deno.env.get("MARKETING_LINK_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export async function sign(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const openPixelUrl = (messageId: string) => `${base()}?action=track&k=open&m=${messageId}`;

export async function clickUrl(messageId: string, url: string): Promise<string> {
  const u = b64url(url);
  return `${base()}?action=track&k=click&m=${messageId}&u=${u}&s=${await sign(`${messageId}|${url}`)}`;
}

/** Rewrites http(s) links (except the unsubscribe link) through the click tracker and adds the open pixel. */
export async function instrument(html: string, messageId: string, keep: string[] = []): Promise<string> {
  const hrefs = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
  let out = html;
  for (const h of hrefs) {
    const raw = h.replaceAll("&amp;", "&");
    if (keep.some((k) => raw.startsWith(k)) || raw.includes("/unsubscribe")) continue;
    out = out.split(`href="${h}"`).join(`href="${(await clickUrl(messageId, raw)).replaceAll("&", "&amp;")}"`);
  }
  const pixel = `<img src="${openPixelUrl(messageId).replaceAll("&", "&amp;")}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;
  return out.includes("</body>") ? out.replace("</body>", `${pixel}</body>`) : out + pixel;
}

/** Turns bare URLs in plain-text bodies into links so they can be tracked. */
export const linkify = (escapedHtml: string) =>
  escapedHtml.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => `<a href="${u}" style="color:#0f9e6e;">${u}</a>`);
