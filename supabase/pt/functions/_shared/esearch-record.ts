// Deed history and value history from a BIS Consultants "esearch" record page
// ({origin}/Property/View/{propId}) — the public record site most Texas
// appraisal districts run (132 of 254 in the 2026-11-08 coverage census).
//
// Which counties: tx-esearch-sites.json, built by
// apps/pt/scripts/build-tx-esearch-sites.mjs — each site VERIFIED live: the
// State parcel layer's PROP_ID opened that county's record page, cold (no
// session), and the page showed the parcel's owner. So for those counties a
// statewide record's account number is this site's property ID.
//
// Read straight from the page's own tables, no AI. Every value is the CAD's
// printed figure; an empty cell stays null. A page is used only if it shows
// the owner the caller already matched — a wrong ID never attaches another
// property's deeds.
import sites from "./tx-esearch-sites.json" with { type: "json" };

export type EsearchSite = {
  county: string;
  origin: string;
  sampleId: string;
  deedHistory: boolean;
  onCadDomain: boolean;
};

const SITES = (sites as unknown as { sites: Record<string, EsearchSite> }).sites;

/** "Angelina" / "angelina" → its verified esearch site, or null. */
export function esearchSite(county: string | null | undefined): EsearchSite | null {
  if (!county) return null;
  return SITES[county.trim().toLowerCase().replace(/\s+county$/i, "").replace(/\s+/g, "-")] ??
    Object.values(SITES).find((s) => s.county.toLowerCase() === county.trim().toLowerCase()) ??
    null;
}

/** Every verified esearch host (for allow-lists). */
export const ESEARCH_HOSTS = new Set(Object.values(SITES).map((s) => new URL(s.origin).hostname));

export type EsearchDeed = {
  date: string | null;
  type: string | null;
  description: string | null;
  seller: string | null;
  buyer: string | null;
  instrumentNum: string | null;
};
export type EsearchValueYear = {
  year: number;
  landValue: number | null;
  improvementValue: number | null;
  marketValue: number | null;
  appraisedValue: number | null;
};

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const cell = (s: string | undefined): string | null => {
  const v = decode(s ?? "");
  return v && !/^(n\/a|none|-+)$/i.test(v) ? v : null;
};

const money = (s: string | undefined): number | null => {
  const v = cell(s);
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "8/15/2014" → "2014-08-15"; anything else → as printed (or null). */
function isoDate(s: string | undefined): string | null {
  const v = cell(s);
  const m = v?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : v;
}

/** The first <table> after a heading matching `heading`: header labels + body rows. */
function tableAfter(html: string, heading: RegExp): { head: string[]; rows: string[][] } | null {
  const at = html.search(heading);
  if (at < 0) return null;
  const rest = html.slice(at);
  const open = rest.search(/<table\b/i);
  const close = rest.search(/<\/table>/i);
  if (open < 0 || close < open) return null;
  // the table must belong to this heading, not a later section
  if (open > 2000) return null;
  const table = rest.slice(open, close);
  const head = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => decode(m[1]).toLowerCase());
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]))
    .filter((r) => r.length > 0);
  return { head, rows };
}

const col = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h));

/** "Property Deed History" table, most recent first, as printed. */
export function parseEsearchDeeds(html: string): EsearchDeed[] {
  const t = tableAfter(html, /Deed History/i);
  if (!t) return [];
  const i = {
    date: col(t.head, /date/),
    type: col(t.head, /^type/),
    desc: col(t.head, /desc/),
    grantor: col(t.head, /grantor/),
    grantee: col(t.head, /grantee/),
    volume: col(t.head, /vol/),
    page: col(t.head, /^page/),
    number: col(t.head, /number|instr/),
  };
  if (i.date < 0 || (i.grantor < 0 && i.grantee < 0)) return [];
  return t.rows
    .map((r) => {
      const number = cell(r[i.number]);
      const vol = cell(r[i.volume]);
      const page = cell(r[i.page]);
      return {
        date: isoDate(r[i.date]),
        type: cell(r[i.type]),
        description: cell(r[i.desc]),
        seller: cell(r[i.grantor]),
        buyer: cell(r[i.grantee]),
        // the clerk's instrument number; older deeds are filed by volume/page
        instrumentNum: number ?? (vol || page ? `Vol ${vol ?? "—"}, Pg ${page ?? "—"}` : null),
      };
    })
    .filter((d) => d.date || d.seller || d.buyer);
}

/** "Roll Value History" table: one row per year, most recent first. */
export function parseEsearchValueHistory(html: string, maxYears = 6): EsearchValueYear[] {
  const t = tableAfter(html, /Value History/i);
  if (!t) return [];
  // Two header layouts seen live (2026-11-08): "Year | Improvements | Land
  // Market | Ag Valuation | …" (7 headers, 7 cells — "Land Market" is the land
  // value), and an older "… | Land | Market | …" with a "Market" header whose
  // cell every row leaves out (8 headers, 7 cells). Map by the headers the
  // rows actually have.
  const rowWidth = Math.max(0, ...t.rows.map((r) => r.length));
  const head =
    rowWidth === t.head.length - 1 ? t.head.filter((h) => !/^market$/.test(h)) : t.head;
  const i = {
    year: col(head, /year/),
    imp: col(head, /improvement/),
    land: col(head, /^land/),
    market: col(head, /^market/),
    appraised: col(head, /appraised/),
  };
  if (i.year < 0) return [];
  const out: EsearchValueYear[] = [];
  for (const r of t.rows) {
    const year = Number(cell(r[i.year]));
    if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) continue;
    if (out.some((y) => y.year === year)) continue;
    const land = money(r[i.land]);
    const imp = money(r[i.imp]);
    // next year's row is listed before values exist ("2027 | N/A | N/A …")
    if (land == null && imp == null && money(r[i.appraised]) == null) continue;
    // esearch leaves Market blank on many sites — it's land + improvements
    const market = money(r[i.market]) || (land != null && imp != null ? land + imp : null);
    out.push({
      year,
      landValue: land,
      improvementValue: imp,
      marketValue: market,
      appraisedValue: money(r[i.appraised]),
    });
  }
  return out.sort((a, b) => b.year - a.year).slice(0, maxYears);
}

// first distinctive word of an owner name ("MATHIS WILLIAM M EST" → "MATHIS")
export function ownerToken(owner: string | null | undefined): string | null {
  return (
    String(owner ?? "")
      .toUpperCase()
      .split(/[^A-Z]+/)
      .find((w) => w.length >= 3 && !/^(THE|AND|LLC|INC|EST|ETAL|ETUX|TRUST|CITY|COUNTY|OF)$/.test(w)) ??
      null
  );
}

/**
 * The record page's deeds and value history — null if the page can't be read,
 * isn't a property record, or doesn't show `expectedOwner`.
 */
export async function fetchEsearchRecord(
  origin: string,
  propertyId: string,
  expectedOwner: string | null,
  timeoutMs = 6000,
): Promise<{ url: string; deeds: EsearchDeed[]; valueHistory: EsearchValueYear[] } | null> {
  const token = ownerToken(expectedOwner);
  if (!token) return null; // nothing to check the page against
  const url = `${origin}/Property/View/${encodeURIComponent(propertyId)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CorvusPT/1.0)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // a wrong ID redirects to /Error/NotFoundProperty/<id> with a 200
    if (!res.ok || /\/Error\//i.test(res.url)) return null;
    const html = await res.text();
    if (!decode(html).toUpperCase().includes(token)) return null;
    return { url, deeds: parseEsearchDeeds(html), valueHistory: parseEsearchValueHistory(html) };
  } catch {
    return null;
  }
}
