// CRM logic for the Marketing workspace — pure (no network), so it's tested
// (marketing-crm.test.ts). Import cleaning + duplicate detection, portfolio
// grouping, lead filters + segments, status-rule descriptions, next-action
// recommendations, and Podio matching / change proposals all live here so
// every screen applies the same rules.
import type {
  Activity,
  Campaign,
  Followup,
  Lead,
  LeadInput,
  LeadProperty,
  MarketingData,
  PropertyInput,
  RuleMode,
  Source,
  Stage,
  SyncFieldChange,
} from "./marketing";
import { daysUntilIso } from "./local-day";

// ── Normalising contact + property details ─────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "icloud.con": "icloud.com",
};

export type Correction = { field: string; from: string; to: string; why: string };

export function cleanEmail(raw: string | null | undefined): {
  value: string | null;
  valid: boolean;
  correction?: Correction;
} {
  const v = (raw ?? "")
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  if (!v) return { value: null, valid: true };
  const at = v.lastIndexOf("@");
  const domain = at > 0 ? v.slice(at + 1) : "";
  const fixed = DOMAIN_TYPOS[domain];
  if (fixed) {
    const to = `${v.slice(0, at)}@${fixed}`;
    return {
      value: to,
      valid: true,
      correction: { field: "email", from: v, to, why: `"${domain}" looks like a typo` },
    };
  }
  return { value: v, valid: EMAIL_RE.test(v) };
}

export function cleanPhone(raw: string | null | undefined): {
  value: string | null;
  valid: boolean;
} {
  const v = (raw ?? "").trim();
  if (!v) return { value: null, valid: true };
  const ext = v.match(/\s*(?:x|ext\.?)\s*(\d+)$/i);
  const digits = v.replace(/\s*(?:x|ext\.?)\s*\d+$/i, "").replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length !== 10) return { value: v, valid: false };
  return {
    value: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}${ext ? ` x${ext[1]}` : ""}`,
    valid: true,
  };
}

const ENTITY_WORDS = new Set([
  "llc",
  "l.l.c.",
  "inc",
  "inc.",
  "lp",
  "l.p.",
  "llp",
  "ltd",
  "ltd.",
  "co",
  "corp",
  "pc",
  "pllc",
  "na",
  "usa",
  "ii",
  "iii",
  "iv",
]);
/** "SMITH JOHN A" / "ACME HOLDINGS LLC" → readable case; leaves mixed-case input alone. */
export function tidyName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (v !== v.toUpperCase() || !/[A-Z]/.test(v)) return v;
  return v
    .toLowerCase()
    .split(" ")
    .map((w) =>
      ENTITY_WORDS.has(w)
        ? w.toUpperCase()
        : w.replace(/(^|[-'])([a-z])/g, (_, a, b) => a + b.toUpperCase()),
    )
    .join(" ");
}

export function cleanCounty(raw: string | null | undefined): string | null {
  const v = (raw ?? "")
    .replace(/\b(central\s+)?appraisal\s+district\b.*$/i, "")
    .replace(/\bcad\b/i, "")
    .replace(/\bcounty\b/i, "")
    .replace(/,?\s*(tx|texas)\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return null;
  return v.replace(
    /\b([a-z])([a-z]*)/gi,
    (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase(),
  );
}

export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const m = raw.replace(/[$,\s]/g, "").match(/^(-?\d+(?:\.\d+)?)([kKmM])?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1);
  return Number.isFinite(n) ? n : null;
}

/** City and ZIP from a one-line US address: "123 Main St, Plano, TX 75074-1234". */
export function splitAddress(raw: string | null | undefined): {
  city: string | null;
  zip: string | null;
} {
  const v = (raw ?? "").trim();
  const zip = v.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const parts = v.split(",").map((s) => s.trim());
  let city: string | null = null;
  if (parts.length >= 3) city = parts[parts.length - 2];
  else if (parts.length === 2 && zip) {
    const m = parts[1].match(/^([A-Za-z .'-]+?)\s+(?:TX|Texas)\b/i);
    city = m ? m[1] : null;
  }
  return { city: city ? tidyName(city) : null, zip };
}

// ── Owner / company identity (portfolio linking, duplicates) ───────────────
const SUFFIXES =
  /\b(l\s?l\s?c|inc|incorporated|l\s?p|llp|ltd|limited|co|corp|corporation|company|pllc|pc|the|et\s?al|etal|et\s?ux|etux)\b/g;
/** A comparison key for an owner/company name: case, punctuation and legal suffixes removed. */
export function ownerKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "SMITH JOHN & MARY" / "A LLC; B LP" → the separate owners on a record. */
export function splitOwners(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .replace(/\bet\s?(al|ux)\b\.?/gi, "")
    .split(/\s*(?:;|\/|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}
export const hasMultipleOwners = (raw: string | null | undefined) =>
  splitOwners(raw).length > 1 || /\bet\s?(al|ux)\b/i.test(raw ?? "");

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}
/** 0..1 — Dice coefficient on character pairs of the owner keys. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = ownerKey(a);
  const y = ownerKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = new Map<string, number>();
  for (const g of bigrams(y)) B.set(g, (B.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of A) {
    const n = B.get(g) ?? 0;
    if (n > 0) {
      hit++;
      B.set(g, n - 1);
    }
  }
  return (2 * hit) / (A.length + bigrams(y).length);
}

export const digitsOf = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

/** Matches marketing_lead_properties.dedupe_key. */
export function propertyKey(p: {
  accountNumber?: string | null;
  county?: string | null;
  address?: string | null;
}): string {
  const acct = (p.accountNumber ?? "").trim();
  return acct
    ? `acct:${(p.county ?? "").toLowerCase()}:${acct.toLowerCase()}`
    : `addr:${(p.address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export const leadName = (l: Pick<Lead, "fullName" | "company" | "email">) =>
  l.company || l.fullName || l.email || "Unnamed lead";

// ── Import: column mapping ──────────────────────────────────────────────────
export const LEAD_FIELDS = [
  "fullName",
  "company",
  "email",
  "phone",
  "address",
  "city",
  "zip",
  "county",
  "propertyType",
  "assessedValue",
  "accountNumber",
  "ownerNames",
  "mailingAddress",
  "notes",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type LeadColumnTarget = LeadField | "ignore";
export const LEAD_FIELD_LABEL: Record<LeadField, string> = {
  fullName: "Contact name",
  company: "Owner / company",
  email: "Email",
  phone: "Phone",
  address: "Property address",
  city: "City",
  zip: "ZIP",
  county: "County",
  propertyType: "Property type",
  assessedValue: "Assessed value",
  accountNumber: "Account / parcel #",
  ownerNames: "Owner(s) on record",
  mailingAddress: "Mailing address",
  notes: "Notes",
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, LeadField> = {};
const alias = (f: LeadField, ...names: string[]) => names.forEach((n) => (ALIASES[norm(n)] = f));
alias(
  "fullName",
  "name",
  "full name",
  "contact",
  "contact name",
  "first and last name",
  "person",
  "primary contact",
);
alias(
  "company",
  "company",
  "company name",
  "business",
  "business name",
  "organization",
  "entity",
  "owner company",
  "llc",
);
alias("email", "email", "e-mail", "email address", "work email", "contact email", "emails");
alias(
  "phone",
  "phone",
  "phone number",
  "mobile",
  "cell",
  "telephone",
  "tel",
  "work phone",
  "phones",
);
alias(
  "address",
  "address",
  "property address",
  "situs",
  "situs address",
  "site address",
  "street address",
  "location",
  "property",
);
alias("city", "city", "property city", "situs city");
alias("zip", "zip", "zip code", "zipcode", "postal code", "property zip");
alias("county", "county", "cad", "appraisal district", "property county");
alias("propertyType", "property type", "type", "use", "property use", "class", "category");
alias(
  "assessedValue",
  "assessed value",
  "appraised value",
  "market value",
  "total value",
  "value",
  "assessment",
  "valuation",
);
alias(
  "accountNumber",
  "account",
  "account number",
  "account #",
  "parcel",
  "parcel id",
  "property id",
  "prop id",
  "geo id",
  "apn",
);
alias("ownerNames", "owner", "owner name", "owners", "owner(s)", "property owner", "record owner");
alias("mailingAddress", "mailing address", "mail address", "owner address", "mailing");
alias("notes", "notes", "note", "comments", "description", "remarks");

export type LeadColumnMapping = {
  header: string;
  field: LeadColumnTarget;
  source: "alias" | "ai" | "user" | "unmapped";
};

export function mapLeadColumns(headers: string[]): LeadColumnMapping[] {
  const used = new Set<LeadField>();
  return headers.map((header) => {
    const f = ALIASES[norm(header)];
    if (f && !used.has(f)) {
      used.add(f);
      return { header, field: f, source: "alias" };
    }
    return { header, field: "ignore", source: "unmapped" };
  });
}

/** Folds AI-suggested fields into the unmapped columns only (never overrides an exact alias). */
export function mergeAiMapping(
  base: LeadColumnMapping[],
  ai: Record<string, string>,
): LeadColumnMapping[] {
  const used = new Set(base.filter((m) => m.field !== "ignore").map((m) => m.field));
  return base.map((m) => {
    if (m.source !== "unmapped") return m;
    const f = ai[m.header] as LeadField | undefined;
    if (f && (LEAD_FIELDS as readonly string[]).includes(f) && !used.has(f)) {
      used.add(f);
      return { ...m, field: f, source: "ai" };
    }
    return m;
  });
}

// ── Import: review ──────────────────────────────────────────────────────────
export type ImportProperty = {
  address: string | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  propertyType: string | null;
  assessedValue: number | null;
  accountNumber: string | null;
  ownerName: string | null;
};
export type Issue = { level: "error" | "warning" | "info"; message: string };
export type ImportAction = "add" | "merge" | "skip";
export type DuplicateMatch = { leadId: string; name: string; confidence: number; reason: string };
export type ImportGroup = {
  key: string;
  rows: number[];
  lead: {
    fullName: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
    ownerNames: string | null;
    mailingAddress: string | null;
    notes: string | null;
  };
  properties: ImportProperty[];
  corrections: Correction[];
  issues: Issue[];
  missing: string[];
  match: DuplicateMatch | null;
  /** Properties already on another lead (possible co-owner or duplicate). */
  sharedWith: { leadId: string; name: string; address: string }[];
  action: ImportAction;
  mergeInto: string | null;
};

export function buildImport(
  rows: string[][],
  mapping: LeadColumnMapping[],
  leads: Lead[],
  properties: LeadProperty[],
  /** false = keep the file as-is; corrections are still listed as suggestions */
  fix = true,
): ImportGroup[] {
  const col = (f: LeadField) => mapping.findIndex((m) => m.field === f);
  const idx = Object.fromEntries(LEAD_FIELDS.map((f) => [f, col(f)])) as Record<LeadField, number>;
  const get = (r: string[], f: LeadField) => (idx[f] >= 0 ? (r[idx[f]] ?? "").trim() : "");

  const groups = new Map<string, ImportGroup>();
  // owner name → the group it belongs to, so a row without an email joins the
  // same owner's row that has one (rows with an email are taken first)
  const ownerGroup = new Map<string, string>();
  const order = rows
    .map((r, i) => ({ r, i, e: cleanEmail(get(r, "email")).valid && !!get(r, "email") }))
    .sort((a, b) => Number(b.e) - Number(a.e) || a.i - b.i);
  order.forEach(({ r, i }) => {
    if (!r.some((c) => (c ?? "").trim())) return;
    const corrections: Correction[] = [];
    const issues: Issue[] = [];
    const em = cleanEmail(get(r, "email"));
    if (em.correction) corrections.push(em.correction);
    if (!em.valid)
      issues.push({ level: "error", message: `Email "${get(r, "email")}" isn't valid` });
    const ph = cleanPhone(get(r, "phone"));
    if (!ph.valid)
      issues.push({
        level: "warning",
        message: `Phone "${get(r, "phone")}" isn't a 10-digit US number`,
      });
    const rawName = get(r, "fullName");
    const rawCompany = get(r, "company");
    const rawOwner = get(r, "ownerNames");
    const fullName = fix ? tidyName(rawName) : rawName || null;
    const company = fix ? tidyName(rawCompany) : rawCompany || null;
    const ownerNames = fix ? tidyName(rawOwner) : rawOwner || null;
    if (rawName && tidyName(rawName) !== rawName)
      corrections.push({
        field: "fullName",
        from: rawName,
        to: tidyName(rawName)!,
        why: "Tidied capitalisation",
      });
    if (rawCompany && tidyName(rawCompany) !== rawCompany)
      corrections.push({
        field: "company",
        from: rawCompany,
        to: tidyName(rawCompany)!,
        why: "Tidied capitalisation",
      });
    const address = get(r, "address") || null;
    const parsed = splitAddress(address);
    const rawCounty = get(r, "county");
    const county = fix ? cleanCounty(rawCounty) : rawCounty || null;
    if (rawCounty && cleanCounty(rawCounty) !== rawCounty)
      corrections.push({
        field: "county",
        from: rawCounty,
        to: cleanCounty(rawCounty) ?? "",
        why: "Standard county name",
      });
    const rawValue = get(r, "assessedValue");
    const value = parseMoney(rawValue);
    if (rawValue && value == null)
      issues.push({ level: "warning", message: `Value "${rawValue}" isn't a number` });
    const prop: ImportProperty | null =
      address || get(r, "accountNumber")
        ? {
            address,
            city: tidyName(get(r, "city")) ?? parsed.city,
            zip: get(r, "zip").match(/\d{5}/)?.[0] ?? parsed.zip,
            county,
            propertyType: get(r, "propertyType") || null,
            assessedValue: value,
            accountNumber: get(r, "accountNumber") || null,
            ownerName: ownerNames ?? company,
          }
        : null;

    // one lead per owner: same email, or the same owner/company name
    const email = em.valid ? (fix ? em.value : get(r, "email").trim().toLowerCase() || null) : null;
    const okey = ownerKey(company || ownerNames || fullName);
    const key = email ? `e:${email}` : okey ? (ownerGroup.get(okey) ?? `o:${okey}`) : `r:${i}`;
    if (okey && !ownerGroup.has(okey)) ownerGroup.set(okey, key);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        rows: [],
        lead: {
          fullName,
          company: company ?? (ownerNames && !fullName ? ownerNames : null),
          email,
          phone: ph.valid ? ph.value : null,
          ownerNames,
          mailingAddress: get(r, "mailingAddress") || null,
          notes: get(r, "notes") || null,
        },
        properties: [],
        corrections: [],
        issues: [],
        missing: [],
        match: null,
        sharedWith: [],
        action: "add",
        mergeInto: null,
      };
      groups.set(key, g);
    } else {
      // fill gaps from later rows of the same owner
      g.lead.fullName ??= fullName;
      g.lead.phone ??= ph.valid ? ph.value : null;
      g.lead.ownerNames ??= ownerNames;
      g.lead.mailingAddress ??= get(r, "mailingAddress") || null;
    }
    g.rows.push(i);
    g.corrections.push(...corrections);
    g.issues.push(...issues);
    if (prop && !g.properties.some((p) => propertyKey(p) === propertyKey(prop)))
      g.properties.push(prop);
  });

  const byEmail = new Map(leads.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]));
  const byPhone = new Map(
    leads.filter((l) => digitsOf(l.phone).length === 10).map((l) => [digitsOf(l.phone), l]),
  );
  const propOwner = new Map<string, LeadProperty[]>();
  for (const p of properties)
    propOwner.set(p.dedupeKey, [...(propOwner.get(p.dedupeKey) ?? []), p]);
  const leadById = new Map(leads.map((l) => [l.id, l]));

  for (const g of groups.values()) {
    const L = g.lead;
    if (!L.email && !L.phone) g.missing.push("email or phone");
    if (!L.fullName && !L.company) g.missing.push("name");
    if (!g.properties.length) g.missing.push("property");
    if (g.properties.some((p) => p.address && !p.county)) g.missing.push("county");
    if (g.properties.some((p) => p.assessedValue == null)) g.missing.push("assessed value");
    if (g.rows.length > 1)
      g.issues.push({ level: "info", message: `${g.rows.length} rows combined — same owner` });
    if (hasMultipleOwners(L.ownerNames))
      g.issues.push({
        level: "info",
        message: `Several owners on record (${L.ownerNames}) — properties stay linked to each`,
      });

    // duplicates in the CRM
    const e = L.email ? byEmail.get(L.email) : undefined;
    const p = digitsOf(L.phone).length === 10 ? byPhone.get(digitsOf(L.phone)) : undefined;
    let match: DuplicateMatch | null = null;
    if (e) match = { leadId: e.id, name: leadName(e), confidence: 1, reason: "Same email" };
    else if (p) match = { leadId: p.id, name: leadName(p), confidence: 0.9, reason: "Same phone" };
    else {
      const nm = L.company || L.fullName;
      let best: { l: Lead; s: number } | null = null;
      for (const l of leads) {
        const s = Math.max(
          nameSimilarity(nm, l.company),
          nameSimilarity(nm, l.fullName),
          nameSimilarity(nm, l.ownerNames),
        );
        if (s >= 0.85 && (!best || s > best.s)) best = { l, s };
      }
      if (best)
        match = {
          leadId: best.l.id,
          name: leadName(best.l),
          confidence: best.s === 1 ? 0.8 : 0.6,
          reason: best.s === 1 ? "Same owner name" : `Similar name (${Math.round(best.s * 100)}%)`,
        };
    }
    g.match = match;
    for (const pr of g.properties)
      for (const ex of propOwner.get(propertyKey(pr)) ?? []) {
        const owner = leadById.get(ex.leadId);
        if (owner && owner.id !== match?.leadId)
          g.sharedWith.push({
            leadId: owner.id,
            name: leadName(owner),
            address: pr.address ?? pr.accountNumber ?? "",
          });
      }
    if (g.sharedWith.length)
      g.issues.push({
        level: "warning",
        message: `Property already in the CRM under ${[...new Set(g.sharedWith.map((s) => s.name))].join(", ")} — co-owner or duplicate?`,
      });

    const hasError =
      g.issues.some((i) => i.level === "error") && !L.phone && !L.fullName && !L.company;
    const empty = !L.email && !L.phone && !L.fullName && !L.company && !g.properties.length;
    if (empty || hasError) g.action = "skip";
    else if (match && match.confidence >= 0.8) {
      g.action = "merge";
      g.mergeInto = match.leadId;
    } else g.action = "add";
  }
  return [...groups.values()];
}

/** Only fills blanks on an existing lead — an import never overwrites what staff already have. */
export function mergePatch(existing: Lead, incoming: ImportGroup["lead"]): LeadInput {
  const patch: LeadInput = {};
  const fill = <K extends keyof ImportGroup["lead"] & keyof LeadInput>(k: K) => {
    if (!existing[k as keyof Lead] && incoming[k])
      (patch as Record<string, unknown>)[k] = incoming[k];
  };
  (["fullName", "company", "email", "phone", "ownerNames", "mailingAddress"] as const).forEach(
    fill,
  );
  if (incoming.notes)
    patch.notes = existing.notes ? `${existing.notes}\n${incoming.notes}` : incoming.notes;
  return patch;
}

export function importProperties(
  leadId: string,
  props: ImportProperty[],
  source: "import" | "podio",
  detail: string,
): PropertyInput[] {
  return props.map((p) => ({ leadId, ...p, source, sourceDetail: detail, verified: false }));
}

// ── Filters + segments ──────────────────────────────────────────────────────
export type LeadFilters = {
  q?: string;
  stages?: Stage[];
  counties?: string[];
  cities?: string[];
  zips?: string[];
  propertyTypes?: string[];
  sources?: Source[];
  minValue?: number | null;
  maxValue?: number | null;
  minProperties?: number | null;
  campaignId?: string | null;
  /** a staff id, "me" or "none" */
  assignedTo?: string | null;
  priority?: "high" | "medium" | "low" | null;
  deadlineWithinDays?: number | null;
};

export const isEmptyFilter = (f: LeadFilters) =>
  !Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));

export function applyFilters(
  leads: Lead[],
  f: LeadFilters,
  ctx: { activities: Activity[]; campaigns: Campaign[]; me: string | null },
  now = new Date(),
): Lead[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const inCampaign = f.campaignId
    ? new Set([
        ...ctx.activities
          .filter((a) => a.campaignId === f.campaignId && a.leadId)
          .map((a) => a.leadId!),
        ...(ctx.campaigns.find((c) => c.id === f.campaignId)?.audience.leadIds ?? []),
      ])
    : null;
  const any = (want: string[] | undefined, have: (string | null)[]) =>
    !want?.length || want.some((w) => have.some((h) => h && h.toLowerCase() === w.toLowerCase()));
  return leads.filter((l) => {
    if (f.stages?.length && !f.stages.includes(l.stage)) return false;
    if (!any(f.counties, [l.county, ...l.counties])) return false;
    if (!any(f.cities, [l.city, ...l.cities])) return false;
    if (!any(f.zips, [l.zip, ...l.zips])) return false;
    if (!any(f.propertyTypes, [l.propertyType, ...l.propertyTypes])) return false;
    if (f.sources?.length && !f.sources.includes(l.source)) return false;
    const v = l.portfolioValue ?? l.appraisedValue;
    if (f.minValue != null && (v ?? 0) < f.minValue) return false;
    if (f.maxValue != null && (v ?? 0) > f.maxValue) return false;
    if (f.minProperties != null && l.portfolioCount < f.minProperties) return false;
    if (inCampaign && !inCampaign.has(l.id)) return false;
    if (f.assignedTo === "none" && l.assignedTo) return false;
    if (f.assignedTo === "me" && l.assignedTo !== ctx.me) return false;
    if (
      f.assignedTo &&
      f.assignedTo !== "none" &&
      f.assignedTo !== "me" &&
      l.assignedTo !== f.assignedTo
    )
      return false;
    if (f.priority && l.priority !== f.priority) return false;
    if (f.deadlineWithinDays != null) {
      const d = daysUntilIso(l.protestDeadline, now);
      if (d == null || d < 0 || d > f.deadlineWithinDays) return false;
    }
    if (q) {
      const hay = [
        l.fullName,
        l.email,
        l.company,
        l.phone,
        l.propertyAddress,
        l.ownerNames,
        l.county,
        l.city,
        l.zip,
        ...l.counties,
        ...l.cities,
        ...l.zips,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export type SuggestedSegment = {
  key: string;
  name: string;
  why: string;
  filters: LeadFilters;
  count: number;
};

/** Ready-made groups, recomputed live, so prospects are always organised. */
export function autoSegments(d: MarketingData, now = new Date()): SuggestedSegment[] {
  const ctx = { activities: d.activities, campaigns: d.campaigns, me: d.me };
  const open: Stage[] = ["new", "researching", "ready", "contacted", "interested", "registered"];
  const out: Omit<SuggestedSegment, "count">[] = [
    {
      key: "hv",
      name: "High-value portfolios",
      why: "Open leads with $2M+ assessed or 3+ properties",
      filters: { stages: open, minValue: 2e6 },
    },
    {
      key: "multi",
      name: "Multi-property owners",
      why: "3+ properties — one conversation, several protests",
      filters: { stages: open, minProperties: 3 },
    },
    {
      key: "ready",
      name: "Ready for outreach",
      why: "Researched and reachable, not contacted yet",
      filters: { stages: ["ready"] },
    },
    {
      key: "deadline",
      name: "Deadline in 30 days",
      why: "Protest deadline coming up — time-sensitive",
      filters: { stages: open, deadlineWithinDays: 30 },
    },
    {
      key: "reg",
      name: "Registered, not subscribed",
      why: "Have an account — closest to converting",
      filters: { stages: ["registered"] },
    },
    {
      key: "interested",
      name: "Interested",
      why: "Said yes — move them to sign-up",
      filters: { stages: ["interested"] },
    },
    {
      key: "nr",
      name: "No response — try a new channel",
      why: "Several attempts, no reply",
      filters: { stages: ["no_response"] },
    },
    {
      key: "research",
      name: "Needs research",
      why: "Missing contact details or property",
      filters: { stages: ["new", "researching"] },
    },
    {
      key: "unassigned",
      name: "Unassigned high priority",
      why: "High priority with nobody on it",
      filters: { priority: "high", assignedTo: "none" },
    },
  ];
  const counts = new Map<string, number>();
  for (const l of d.leads)
    for (const c of l.counties.length ? l.counties : l.county ? [l.county] : [])
      counts.set(c, (counts.get(c) ?? 0) + 1);
  const topCounty = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCounty)
    out.push({
      key: `county-${topCounty[0]}`,
      name: `${topCounty[0]} County prospects`,
      why: "Your largest county — good for a county-specific deadline message",
      filters: { stages: open, counties: [topCounty[0]] },
    });
  return out
    .map((s) => ({ ...s, count: applyFilters(d.leads, s.filters, ctx, now).length }))
    .filter((s) => s.count > 0);
}

export function describeFilters(
  f: LeadFilters,
  labels: {
    stage: (s: Stage) => string;
    staff: (id: string) => string;
    campaign: (id: string) => string;
  },
): string {
  const parts: string[] = [];
  if (f.stages?.length) parts.push(f.stages.map(labels.stage).join(" / "));
  if (f.counties?.length) parts.push(`${f.counties.join(", ")} County`);
  if (f.cities?.length) parts.push(f.cities.join(", "));
  if (f.zips?.length) parts.push(`ZIP ${f.zips.join(", ")}`);
  if (f.propertyTypes?.length) parts.push(f.propertyTypes.join(", "));
  if (f.minValue != null) parts.push(`≥ $${f.minValue.toLocaleString("en-US")}`);
  if (f.maxValue != null) parts.push(`≤ $${f.maxValue.toLocaleString("en-US")}`);
  if (f.minProperties != null) parts.push(`${f.minProperties}+ properties`);
  if (f.deadlineWithinDays != null) parts.push(`deadline ≤ ${f.deadlineWithinDays} days`);
  if (f.priority) parts.push(`${f.priority} priority`);
  if (f.assignedTo)
    parts.push(
      f.assignedTo === "none"
        ? "unassigned"
        : f.assignedTo === "me"
          ? "assigned to me"
          : `assigned to ${labels.staff(f.assignedTo)}`,
    );
  if (f.campaignId) parts.push(`in "${labels.campaign(f.campaignId)}"`);
  if (f.sources?.length) parts.push(f.sources.join(", "));
  if (f.q) parts.push(`"${f.q}"`);
  return parts.join(" · ") || "All leads";
}

// ── Status rules (descriptions; logic in marketing_apply_rules) ────────────
export const RULES: {
  id: string;
  label: string;
  detail: string;
  fallback: RuleMode;
  locked?: boolean;
}[] = [
  {
    id: "needs_research",
    label: "New Lead → Researching",
    detail: "No email/phone or no property yet",
    fallback: "auto",
  },
  {
    id: "research_complete",
    label: "→ Ready for Outreach",
    detail: "Has an email or phone and at least one property",
    fallback: "auto",
  },
  {
    id: "outreach_contacted",
    label: "→ Contacted",
    detail: "An email was sent or a call/email was logged",
    fallback: "auto",
  },
  {
    id: "outcome_interested",
    label: "→ Interested",
    detail: 'Staff logged the outcome "Interested"',
    fallback: "auto",
  },
  {
    id: "outcome_replied",
    label: "No Response → Contacted",
    detail: "Staff logged that they replied",
    fallback: "auto",
  },
  {
    id: "outcome_not_interested",
    label: "→ Not Interested",
    detail: 'Staff logged the outcome "Not interested"',
    fallback: "suggest",
  },
  {
    id: "no_response",
    label: "Contacted → No Response",
    detail: "2+ outreach attempts and nothing back within the quiet period",
    fallback: "suggest",
  },
  {
    id: "outcome_do_not_contact",
    label: "→ Do Not Contact",
    detail: "They asked not to be contacted",
    fallback: "auto",
  },
  {
    id: "unsubscribed_dnc",
    label: "Unsubscribed → Do Not Contact",
    detail: "They used the unsubscribe link (email stops either way)",
    fallback: "suggest",
  },
];
export const ruleMode = (rules: Record<string, RuleMode>, id: string): RuleMode =>
  rules[id] ?? RULES.find((r) => r.id === id)?.fallback ?? "off";

// ── Portfolio + protest opportunity ─────────────────────────────────────────
// Rough, clearly-labelled estimate for prioritising — not a quote: a 5% value
// reduction at a typical ~2.2% Texas combined tax rate.
export const EST_REDUCTION = 0.05;
export const EST_TAX_RATE = 0.022;
export const estSavings = (value: number | null | undefined) =>
  value ? Math.round(value * EST_REDUCTION * EST_TAX_RATE) : 0;

export type Opportunity = { level: "strong" | "good" | "check"; note: string };
export function opportunity(p: LeadProperty, now = new Date()): Opportunity | null {
  if (p.assessedValue && p.priorValue && p.priorValue > 0) {
    const up = p.assessedValue / p.priorValue - 1;
    if (up >= 0.1)
      return { level: "strong", note: `Value up ${Math.round(up * 100)}% on last year` };
    if (up >= 0.05)
      return { level: "good", note: `Value up ${Math.round(up * 100)}% on last year` };
  }
  const d = daysUntilIso(p.protestDeadline, now);
  if (d != null && d >= 0 && d <= 45)
    return { level: "good", note: `Protest deadline in ${d} days` };
  if ((p.assessedValue ?? 0) >= 1e6) return { level: "good", note: "High value — worth a review" };
  if (p.assessedValue == null) return { level: "check", note: "No value yet — research it" };
  return null;
}

export type PortfolioRow = {
  lead: Lead;
  props: LeadProperty[];
  total: number;
  counties: string[];
  savings: number;
  coOwned: number;
  related: { leadId: string; name: string }[];
  highValue: boolean;
  strong: number;
};

export function portfolios(d: Pick<MarketingData, "leads" | "properties">): PortfolioRow[] {
  const byLead = new Map<string, LeadProperty[]>();
  const byKey = new Map<string, Set<string>>();
  for (const p of d.properties) {
    byLead.set(p.leadId, [...(byLead.get(p.leadId) ?? []), p]);
    byKey.set(p.dedupeKey, (byKey.get(p.dedupeKey) ?? new Set()).add(p.leadId));
  }
  const byOwner = new Map<string, Lead[]>();
  for (const l of d.leads) {
    const k = ownerKey(l.company || l.ownerNames);
    if (k.length > 3) byOwner.set(k, [...(byOwner.get(k) ?? []), l]);
  }
  return d.leads
    .filter((l) => (byLead.get(l.id)?.length ?? 0) > 0)
    .map((lead) => {
      const props = byLead.get(lead.id)!;
      const total = props.reduce((s, p) => s + (p.assessedValue ?? 0), 0);
      const counties = [...new Set(props.map((p) => p.county).filter(Boolean) as string[])];
      const k = ownerKey(lead.company || lead.ownerNames);
      return {
        lead,
        props,
        total,
        counties,
        savings: props.reduce((s, p) => s + estSavings(p.assessedValue), 0),
        coOwned: props.filter((p) => (byKey.get(p.dedupeKey)?.size ?? 0) > 1).length,
        related: (byOwner.get(k) ?? [])
          .filter((o) => o.id !== lead.id)
          .map((o) => ({ leadId: o.id, name: leadName(o) })),
        highValue: total >= 5e6 || props.length >= 5,
        strong: props.filter((p) => opportunity(p)?.level === "strong").length,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ── Recommendations ─────────────────────────────────────────────────────────
export type Recommendation = {
  priority: "high" | "medium" | "low";
  why: string[];
  action: string;
  channel: "email" | "call" | "task" | "none";
  dueInDays: number;
  campaign: { id: string; name: string } | null;
  /** the action is an already-planned follow-up */
  planned?: boolean;
};

export function recommend(
  l: Lead,
  d: Pick<MarketingData, "activities" | "followups" | "campaigns">,
  score: number,
  now = new Date(),
): Recommendation {
  const why: string[] = [];
  const deadline = daysUntilIso(l.protestDeadline, now);
  const worth = l.portfolioValue ?? l.appraisedValue ?? 0;
  const outreach = d.activities.filter(
    (a) => a.leadId === l.id && ["email", "sms", "call"].includes(a.kind),
  );
  const lastOut = outreach[0]?.createdAt
    ? (now.getTime() - new Date(outreach[0].createdAt).getTime()) / 864e5
    : null;
  const pending = d.followups.filter((f: Followup) => f.leadId === l.id && f.status === "pending");

  if (l.stage === "do_not_contact")
    return {
      priority: "low",
      why: ["Marked Do Not Contact"],
      action: "No outreach — Do Not Contact.",
      channel: "none",
      dueInDays: 0,
      campaign: null,
    };
  if (l.stage === "subscribed")
    return {
      priority: "low",
      why: ["Already subscribed"],
      action: "Customer — ask for a referral or a review after their protest.",
      channel: "task",
      dueInDays: 30,
      campaign: null,
    };
  if (l.stage === "not_interested")
    return {
      priority: "low",
      why: ["Not interested"],
      action: "Leave for now — revisit before next protest season.",
      channel: "none",
      dueInDays: 120,
      campaign: null,
    };

  let priority: Recommendation["priority"] = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  if (deadline != null && deadline >= 0 && deadline <= 21) {
    priority = "high";
    why.push(`Protest deadline in ${deadline} days`);
  }
  if (worth >= 5e6 || l.portfolioCount >= 5) {
    priority = "high";
    why.push(
      l.portfolioCount > 1 ? `${l.portfolioCount}-property portfolio` : "High-value property",
    );
  }
  if (l.stage === "interested") {
    priority = "high";
    why.push("Said they're interested");
  }
  if (score >= 60) why.push(`Score ${score}`);

  const missing = [
    !l.email && !l.phone && "email or phone",
    l.portfolioCount === 0 && "property",
  ].filter(Boolean) as string[];
  const call = !!l.phone && (priority === "high" || l.stage === "interested");
  const urgent = deadline != null && deadline >= 0 && deadline <= 21 ? 0 : null;
  let action: string;
  let channel: Recommendation["channel"];
  let due: number;
  let planned = false;
  if (missing.length && ["new", "researching"].includes(l.stage)) {
    action = `Research: find their ${missing.join(" and ")}.`;
    channel = "task";
    due = 0;
  } else if (["new", "researching", "ready"].includes(l.stage)) {
    action = call
      ? "First call — introduce CorvusPT and their protest opportunity."
      : "Send a first email about their property's protest opportunity.";
    channel = call ? "call" : "email";
    due = urgent ?? (priority === "high" ? 0 : 1);
  } else if (l.stage === "contacted") {
    const gap = priority === "high" ? 3 : 5;
    const wait = lastOut == null ? 0 : Math.max(0, Math.ceil(gap - lastOut));
    action =
      outreach.length >= 2 && l.phone
        ? "Call — they haven't answered emails."
        : "Follow up on the last message.";
    channel = outreach.length >= 2 && l.phone ? "call" : "email";
    due = urgent ?? wait;
  } else if (l.stage === "interested") {
    action = l.phone
      ? "Call to walk them through signing up."
      : "Email the sign-up link and offer a call.";
    channel = l.phone ? "call" : "email";
    due = 0;
  } else if (l.stage === "registered") {
    action = "Help them subscribe — show the savings on their top property.";
    channel = l.phone && priority === "high" ? "call" : "email";
    due = urgent ?? 1;
  } else {
    action =
      l.phone && !outreach.some((a) => a.kind === "call")
        ? "Try a call — email got no reply."
        : "Add to a monthly nurture campaign.";
    channel = l.phone ? "call" : "email";
    due = 14;
  }
  if (pending.length && channel !== "task") {
    // a follow-up is already planned — that's the next action
    const next = pending[0];
    const verb = {
      email: "Send the planned email",
      sms: "Send the planned text",
      call: "Make the planned call",
      task: "Do the planned task",
    }[next.channel];
    const late = new Date(next.dueAt) < now;
    action = `${verb}${next.subject ? ` — "${next.subject}"` : ""}${late ? " (overdue)" : ""}.`;
    channel = next.channel === "sms" ? "email" : next.channel;
    planned = true;
    due = Math.max(0, Math.ceil((new Date(next.dueAt).getTime() - now.getTime()) / 864e5));
  }

  const live = d.campaigns.filter(
    (c) => ["draft", "approved", "scheduled"].includes(c.status) && c.channel === "email",
  );
  const fit = live.find((c) => {
    const a = c.audience;
    if (a.leadIds?.length) return a.leadIds.includes(l.id);
    if (a.stages?.length && !a.stages.includes(l.stage)) return false;
    if (a.counties?.length && !a.counties.some((x) => l.counties.includes(x) || l.county === x))
      return false;
    return true;
  });
  return {
    priority,
    why,
    action,
    channel,
    dueInDays: due,
    planned,
    campaign: fit && l.email ? { id: fit.id, name: fit.name } : null,
  };
}

// ── Podio matching + change proposals ───────────────────────────────────────
export type PodioField = { externalId: string; label: string; type: string; text: string };
export type PodioContactItem = {
  itemId: number;
  appId: number;
  title: string;
  fields: PodioField[];
};
/** CRM lead fields a Podio field can map to. */
export const PODIO_TARGETS = [
  "fullName",
  "company",
  "email",
  "phone",
  "ownerNames",
  "mailingAddress",
  "address",
  "city",
  "zip",
  "county",
  "propertyType",
  "assessedValue",
  "accountNumber",
  "notes",
] as const;
export type PodioTarget = (typeof PODIO_TARGETS)[number];
/** Podio field types we can write back to (fill-blank only). */
export const PODIO_WRITABLE = new Set(["text", "email", "phone", "number", "money", "location"]);

export function guessPodioMapping(
  fields: { externalId: string; label: string; type: string }[],
): Record<string, PodioTarget> {
  const out: Record<string, PodioTarget> = {};
  const used = new Set<string>();
  for (const f of fields) {
    let t: PodioTarget | undefined =
      f.type === "email"
        ? "email"
        : f.type === "phone"
          ? "phone"
          : (ALIASES[norm(f.label)] as PodioTarget | undefined);
    if (!t) t = ALIASES[norm(f.externalId)] as PodioTarget | undefined;
    if (t && (PODIO_TARGETS as readonly string[]).includes(t) && !used.has(t)) {
      out[f.externalId] = t;
      used.add(t);
    }
  }
  return out;
}

export type PodioValues = Partial<Record<PodioTarget, string>>;
export function podioValues(item: PodioContactItem, mapping: Record<string, string>): PodioValues {
  const v: PodioValues = {};
  for (const f of item.fields) {
    const t = mapping[f.externalId] as PodioTarget | undefined;
    if (!t || !f.text) continue;
    const text =
      t === "email"
        ? f.text.split(/[,;]\s*/)[0]
        : t === "phone"
          ? f.text.split(/[,;]\s*/)[0]
          : f.text;
    v[t] = text;
  }
  if (!v.fullName && !v.company && item.title) v.fullName = item.title;
  return v;
}

export type PodioMatch = { lead: Lead; confidence: number; reason: string };
export function matchPodio(
  item: PodioContactItem,
  v: PodioValues,
  leads: Lead[],
): PodioMatch | null {
  const linked = leads.find(
    (l) => l.podioItemId === item.itemId && (l.podioAppId == null || l.podioAppId === item.appId),
  );
  if (linked) return { lead: linked, confidence: 1, reason: "Already linked to this Podio item" };
  const email = cleanEmail(v.email).value;
  if (email) {
    const l = leads.find((x) => x.email?.toLowerCase() === email);
    if (l) return { lead: l, confidence: 0.95, reason: "Same email" };
  }
  const ph = digitsOf(v.phone);
  if (ph.length === 10) {
    const l = leads.find((x) => digitsOf(x.phone) === ph);
    if (l) return { lead: l, confidence: 0.85, reason: "Same phone" };
  }
  const nm = v.company || v.fullName;
  let best: PodioMatch | null = null;
  for (const l of leads) {
    if (l.podioItemId && l.podioItemId !== item.itemId) continue; // linked to another item
    const s = Math.max(nameSimilarity(nm, l.company), nameSimilarity(nm, l.fullName));
    if (s < 0.85) continue;
    const zipHit = !!v.zip && (l.zip === v.zip || l.zips.includes(v.zip));
    const addrHit =
      !!v.address && !!l.propertyAddress && ownerKey(v.address) === ownerKey(l.propertyAddress);
    const c = s === 1 && (zipHit || addrHit) ? 0.8 : s === 1 ? 0.6 : 0.5;
    const reason = `${s === 1 ? "Same name" : `Similar name (${Math.round(s * 100)}%)`}${zipHit || addrHit ? " and address" : " only — verify"}`;
    if (!best || c > best.confidence) best = { lead: l, confidence: c, reason };
  }
  return best;
}

const LEAD_COL: Partial<Record<PodioTarget, keyof Lead>> = {
  fullName: "fullName",
  company: "company",
  email: "email",
  phone: "phone",
  ownerNames: "ownerNames",
  mailingAddress: "mailingAddress",
  city: "city",
  zip: "zip",
};
export const PODIO_TARGET_LABEL: Record<PodioTarget, string> = {
  fullName: "Contact name",
  company: "Owner / company",
  email: "Email",
  phone: "Phone",
  ownerNames: "Owner(s) on record",
  mailingAddress: "Mailing address",
  address: "Property address",
  city: "City",
  zip: "ZIP",
  county: "County",
  propertyType: "Property type",
  assessedValue: "Assessed value",
  accountNumber: "Account #",
  notes: "Notes",
};

export type SyncProposal = {
  direction: "podio_to_crm" | "crm_to_podio";
  kind: "create" | "update" | "link";
  leadId: string | null;
  podioAppId: number;
  podioItemId: number;
  title: string;
  changes: SyncFieldChange[];
  payload: Record<string, unknown> | null;
  matchConfidence: number | null;
  matchReason: string | null;
};

const same = (a: string | null | undefined, b: string | null | undefined, t: PodioTarget) => {
  if (t === "email") return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  if (t === "phone") return digitsOf(a) === digitsOf(b);
  return ownerKey(a) === ownerKey(b);
};

/**
 * What a sync would change, as proposals for staff to approve. Never deletes,
 * never overwrites: Podio → CRM fills blanks (conflicts are shown, not
 * applied), CRM → Podio fills empty Podio fields only, and uncertain matches
 * are proposed as links for a person to confirm.
 */
export function podioProposals(
  items: PodioContactItem[],
  mapping: Record<string, string>,
  leads: Lead[],
): SyncProposal[] {
  const out: SyncProposal[] = [];
  for (const item of items) {
    const v = podioValues(item, mapping);
    const title = v.company || v.fullName || item.title || `Podio item ${item.itemId}`;
    const m = matchPodio(item, v, leads);
    if (!m) {
      if (!v.email && !v.phone && !v.fullName && !v.company) continue;
      out.push({
        direction: "podio_to_crm",
        kind: "create",
        leadId: null,
        podioAppId: item.appId,
        podioItemId: item.itemId,
        title: `New lead: ${title}`,
        changes: Object.entries(v).map(([k, to]) => ({
          field: k,
          label: PODIO_TARGET_LABEL[k as PodioTarget],
          from: null,
          to: to!,
        })),
        payload: v as Record<string, unknown>,
        matchConfidence: null,
        matchReason: "No matching lead in the CRM",
      });
      continue;
    }
    const l = m.lead;
    if (m.confidence < 0.8) {
      out.push({
        direction: "podio_to_crm",
        kind: "link",
        leadId: l.id,
        podioAppId: item.appId,
        podioItemId: item.itemId,
        title: `Possible match: ${title} ↔ ${leadName(l)}`,
        changes: [],
        payload: v as Record<string, unknown>,
        matchConfidence: m.confidence,
        matchReason: m.reason,
      });
      continue;
    }
    const toCrm: SyncFieldChange[] = [];
    const conflicts: SyncFieldChange[] = [];
    for (const [k, to] of Object.entries(v) as [PodioTarget, string][]) {
      const col = LEAD_COL[k];
      if (!col) continue;
      const cur = l[col] as string | null;
      if (!cur) toCrm.push({ field: k, label: PODIO_TARGET_LABEL[k], from: null, to });
      else if (!same(cur, to, k))
        conflicts.push({
          field: k,
          label: `${PODIO_TARGET_LABEL[k]} (differs — CRM kept unless approved)`,
          from: cur,
          to,
        });
    }
    const needsLink = l.podioItemId !== item.itemId;
    if (toCrm.length || conflicts.length || needsLink)
      out.push({
        direction: "podio_to_crm",
        kind: needsLink && !toCrm.length && !conflicts.length ? "link" : "update",
        leadId: l.id,
        podioAppId: item.appId,
        podioItemId: item.itemId,
        title: `${leadName(l)} ← Podio`,
        changes: [...toCrm, ...conflicts],
        payload: needsLink ? { link: true } : null,
        matchConfidence: m.confidence,
        matchReason: m.reason,
      });
    // CRM → Podio: only into empty, writable Podio fields
    const back: SyncFieldChange[] = [];
    for (const f of item.fields) {
      const t = mapping[f.externalId] as PodioTarget | undefined;
      const col = t ? LEAD_COL[t] : undefined;
      if (!t || !col || f.text || !PODIO_WRITABLE.has(f.type)) continue;
      const val = l[col] as string | null;
      if (val)
        back.push({
          field: t,
          label: f.label,
          from: null,
          to: val,
          podioExternalId: f.externalId,
          podioType: f.type,
        });
    }
    if (back.length)
      out.push({
        direction: "crm_to_podio",
        kind: "update",
        leadId: l.id,
        podioAppId: item.appId,
        podioItemId: item.itemId,
        title: `${leadName(l)} → Podio`,
        changes: back,
        payload: null,
        matchConfidence: m.confidence,
        matchReason: m.reason,
      });
  }
  return out;
}

/** The property a Podio contact describes (if its address/account fields are mapped). */
export function podioProperty(v: PodioValues): ImportProperty | null {
  if (!v.address && !v.accountNumber) return null;
  const parsed = splitAddress(v.address);
  return {
    address: v.address ?? null,
    city: v.city ?? parsed.city,
    zip: v.zip ?? parsed.zip,
    county: cleanCounty(v.county),
    propertyType: v.propertyType ?? null,
    assessedValue: parseMoney(v.assessedValue),
    accountNumber: v.accountNumber ?? null,
    ownerName: v.ownerNames ?? v.company ?? null,
  };
}
