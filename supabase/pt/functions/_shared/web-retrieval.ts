// AI web/PDF retrieval for official sources: fetch a site's pages (and linked
// PDFs), keep their text, and let the AI extract facts FROM THAT TEXT ONLY.
// Deliberately not "search the web" — Gemini's Google Search grounding has never
// returned for this project's key (see market-listings/index.ts) — and not open
// to arbitrary URLs: callers pass an official starting URL (e.g. an appraisal
// district's website from the Texas Comptroller's directory), and only that site's
// own pages are followed.
//
// The extraction is checked afterwards: a URL or email the AI returns must appear
// in what was actually fetched, or it's dropped (see grounded*). The AI reads; it
// doesn't get to invent.

const TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_PDF_BYTES = 6_000_000;
const MAX_TEXT_PER_PAGE = 20_000;

export type FetchedPage = { url: string; text: string; links: { url: string; label: string }[] };
export type FetchedPdf = { url: string; base64: string };

function sameSite(a: URL, b: URL): boolean {
  const root = (h: string) => h.replace(/^www\./, "");
  return root(a.hostname) === root(b.hostname);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function extractLinks(html: string, base: URL): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1], base);
      if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "mailto:") continue;
      out.push({ url: url.toString(), label: htmlToText(m[2]).slice(0, 120) });
    } catch {
      // unparseable href — skip
    }
  }
  return out;
}

async function get(url: string, maxBytes: number): Promise<{ type: string; bytes: Uint8Array } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "CorvusPT/1.0 (+https://corvusre.com) property tax procedures reader",
        accept: "text/html,application/pdf;q=0.9,*/*;q=0.5",
      },
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) return null;
    return { type: res.headers.get("content-type") ?? "", bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Reads the start page plus up to `maxPages` same-site links (and `maxPdfs` PDFs)
// whose link text or URL matches `follow`.
export async function readOfficialSite(
  startUrl: string,
  follow: RegExp,
  opts: { maxPages?: number; maxPdfs?: number } = {},
): Promise<{ pages: FetchedPage[]; pdfs: FetchedPdf[] }> {
  const maxPages = opts.maxPages ?? 4;
  const maxPdfs = opts.maxPdfs ?? 2;
  const start = new URL(startUrl.startsWith("http") ? startUrl : `https://${startUrl}`);
  const pages: FetchedPage[] = [];
  const pdfs: FetchedPdf[] = [];
  const seen = new Set<string>();

  const readHtml = async (url: URL): Promise<FetchedPage | null> => {
    const r = await get(url.toString(), MAX_HTML_BYTES);
    if (!r || !r.type.includes("html")) return null;
    const html = new TextDecoder().decode(r.bytes);
    return { url: url.toString(), text: htmlToText(html).slice(0, MAX_TEXT_PER_PAGE), links: extractLinks(html, url) };
  };

  const home = await readHtml(start);
  if (!home) return { pages, pdfs };
  pages.push(home);
  seen.add(start.toString());

  const candidates = home.links.filter((l) => {
    if (l.url.startsWith("mailto:")) return false;
    try {
      return sameSite(new URL(l.url), start) && (follow.test(l.label) || follow.test(l.url));
    } catch {
      return false;
    }
  });
  for (const l of candidates) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    if (/\.pdf(\?|$)/i.test(l.url)) {
      if (pdfs.length >= maxPdfs) continue;
      const r = await get(l.url, MAX_PDF_BYTES);
      if (r && (r.type.includes("pdf") || /\.pdf/i.test(l.url))) pdfs.push({ url: l.url, base64: toBase64(r.bytes) });
    } else {
      if (pages.length > maxPages) continue;
      const p = await readHtml(new URL(l.url));
      if (p) pages.push(p);
    }
  }
  return { pages, pdfs };
}

// Everything that was actually fetched, for checking the AI's answers against.
export function corpus(pages: FetchedPage[]): { text: string; urls: Set<string>; emails: Set<string> } {
  const urls = new Set<string>();
  const emails = new Set<string>();
  for (const p of pages) {
    urls.add(p.url);
    for (const l of p.links) {
      if (l.url.startsWith("mailto:")) emails.add(l.url.slice(7).split("?")[0].toLowerCase());
      else urls.add(l.url);
    }
    for (const m of p.text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0].toLowerCase());
  }
  return { text: pages.map((p) => p.text).join("\n"), urls, emails };
}

const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();

export function groundedUrl(v: unknown, c: { urls: Set<string> }): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const want = norm(v.trim());
  for (const u of c.urls) if (norm(u) === want) return u;
  return null;
}

export function groundedEmail(v: unknown, c: { emails: Set<string> }): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return c.emails.has(e) ? e : null;
}

// A phone number counts only if its digits appear in the fetched text.
export function groundedPhone(v: unknown, c: { text: string }): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return null;
  const textDigits = c.text.replace(/\D/g, "");
  return textDigits.includes(digits) ? v.trim() : null;
}
