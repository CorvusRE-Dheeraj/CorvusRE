// CRM logic for the Marketing workspace — pure (no network), so it's tested
// (marketing-crm.test.ts). Import cleaning + duplicate detection, portfolio
// grouping, lead filters + segments, status-rule descriptions, next-action
// recommendations, and Podio matching / change proposals all live here so
// every screen applies the same rules.
import type {
  Activity,
  AssessmentAnalysis,
  AssessmentFlag,
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
  Template,
  TemplateObjective,
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
  /** biggest year-over-year assessed-value increase in the portfolio, in % */
  minChangePct?: number | null;
  /** only leads with a property the assessment review flagged */
  flaggedOnly?: boolean | null;
  engagement?: "never_contacted" | "engaged" | "unresponsive" | null;
};

export const isEmptyFilter = (f: LeadFilters) =>
  !Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));

export function applyFilters(
  leads: Lead[],
  f: LeadFilters,
  ctx: {
    activities: Activity[];
    campaigns: Campaign[];
    me: string | null;
    /** the shown priority (staff override or the explained ranking) */
    priorityOf?: (l: Lead) => "high" | "medium" | "low";
  },
  now = new Date(),
): Lead[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const touched = new Map<string, { out: number; recent: boolean; reply: boolean }>();
  if (f.engagement)
    for (const a of ctx.activities) {
      if (!a.leadId) continue;
      const t = touched.get(a.leadId) ?? { out: 0, recent: false, reply: false };
      if (["email", "sms", "call"].includes(a.kind)) t.out++;
      if (a.outcome === "interested" || a.outcome === "replied") t.reply = true;
      if (now.getTime() - new Date(a.createdAt).getTime() < 30 * 864e5 && a.createdBy)
        t.recent = true;
      touched.set(a.leadId, t);
    }
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
    if (f.priority && (ctx.priorityOf ? ctx.priorityOf(l) : l.priority) !== f.priority)
      return false;
    if (f.minChangePct != null && (l.maxChangePct ?? -Infinity) < f.minChangePct) return false;
    if (f.flaggedOnly && l.flaggedCount === 0) return false;
    if (f.engagement) {
      const t = touched.get(l.id) ?? { out: 0, recent: false, reply: false };
      if (f.engagement === "never_contacted" && (t.out > 0 || l.lastContactedAt)) return false;
      if (
        f.engagement === "engaged" &&
        !(t.reply || ["interested", "registered"].includes(l.stage))
      )
        return false;
      if (f.engagement === "unresponsive" && !(t.out >= 2 && !t.reply)) return false;
    }
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
export function autoSegments(
  d: MarketingData,
  now = new Date(),
  priorityOf?: (l: Lead) => "high" | "medium" | "low",
): SuggestedSegment[] {
  const ctx = { activities: d.activities, campaigns: d.campaigns, me: d.me, priorityOf };
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
  if (f.minChangePct != null) parts.push(`value up ${f.minChangePct}%+`);
  if (f.flaggedOnly) parts.push("flagged for review");
  if (f.engagement)
    parts.push(
      { never_contacted: "never contacted", engaged: "engaged", unresponsive: "no reply yet" }[
        f.engagement
      ],
    );
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
  const pending = d.followups.filter(
    (f: Followup) => f.leadId === l.id && (f.status === "pending" || f.status === "draft"),
  );

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
    // an unanswered email → try the phone
    const lastWasEmail = outreach[0]?.kind === "email";
    if (lastWasEmail && l.phone) {
      action = "Call — the last email got no reply.";
      channel = "call";
    } else {
      action = "Follow up on the last message.";
      channel = "email";
    }
    due = urgent ?? wait;
  } else if (l.stage === "interested") {
    action = "Send their registration link (prefilled) and offer to walk them through it.";
    channel = l.email ? "email" : "call";
    due = 0;
  } else if (l.stage === "registration_started") {
    action = "They started registering but didn't finish — send the link back to sign-up.";
    channel = l.email ? "email" : "call";
    due = 0;
  } else if (l.stage === "registered") {
    action =
      l.portfolioCount > 1
        ? `Registered, no property yet — they own ${l.portfolioCount}: offer the spreadsheet upload to add them all.`
        : "Registered, no property yet — send the link to add their property.";
    channel = l.phone && priority === "high" ? "call" : "email";
    due = urgent ?? 1;
  } else if (l.stage === "property_added") {
    action =
      l.portfolioCount > 1
        ? `Added a property — they own ${l.portfolioCount}: help them add the rest and start their protest.`
        : "Added a property, not subscribed — show what the plan covers and help them start their protest.";
    channel = l.phone && priority !== "low" ? "call" : "email";
    due = urgent ?? 1;
  } else if (l.stage === "subscription_started") {
    action = "Checkout not finished — send the link back to finish, or call to help.";
    channel = l.phone ? "call" : "email";
    due = 0;
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
      meeting: "Hold the planned meeting",
      task: "Do the planned task",
    }[next.channel];
    const late = new Date(next.dueAt) < now;
    action = `${verb}${next.subject ? ` — "${next.subject}"` : ""}${late ? " (overdue)" : ""}.`;
    channel = next.channel === "sms" ? "email" : next.channel === "meeting" ? "call" : next.channel;
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

// ── Assessment review ───────────────────────────────────────────────────────
export type CompsSummary = {
  count: number;
  median: number | null;
  medianPerAcre: number | null;
  subjectPerAcre: number | null;
};
const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
/** Comparable parcels reduced to what the review needs (per-acre where acreage is published). */
export function summarizeComps(
  subject: { value: number | null; acres: number | null },
  comps: {
    marketValue: number | null;
    appraisedValue?: number | null;
    legalAcreage?: number | null;
  }[],
): CompsSummary {
  const val = (c: (typeof comps)[number]) => c.appraisedValue ?? c.marketValue ?? null;
  return {
    count: comps.length,
    median: median(comps.map((c) => val(c) ?? NaN)),
    medianPerAcre: median(
      comps.map((c) => (c.legalAcreage && val(c) ? val(c)! / c.legalAcreage : NaN)),
    ),
    subjectPerAcre: subject.value && subject.acres ? subject.value / subject.acres : null,
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Signs an assessment may be worth protesting, each explained in plain words.
 * Indicators only — never a claim the value will come down.
 */
export function assessmentFlags(
  p: {
    assessedValue: number | null;
    priorValue: number | null;
    valueYear?: number | null;
    priorYear?: number | null;
    protestDeadline: string | null;
  },
  comps: CompsSummary | null,
  now = new Date(),
): AssessmentFlag[] {
  const out: AssessmentFlag[] = [];
  if (p.assessedValue && p.priorValue && p.priorValue > 0) {
    const up = (p.assessedValue / p.priorValue - 1) * 100;
    const yrs = p.valueYear && p.priorYear ? ` (${p.priorYear} → ${p.valueYear})` : "";
    if (up >= 10)
      out.push({
        kind: "increase",
        level: "strong",
        text: `Assessed value up ${up.toFixed(1)}%${yrs}: ${usd(p.priorValue)} → ${usd(p.assessedValue)}.`,
      });
    else if (up >= 5)
      out.push({
        kind: "increase",
        level: "moderate",
        text: `Assessed value up ${up.toFixed(1)}%${yrs}: ${usd(p.priorValue)} → ${usd(p.assessedValue)}.`,
      });
  }
  if (comps && comps.count >= 3 && comps.subjectPerAcre && comps.medianPerAcre) {
    const r = comps.subjectPerAcre / comps.medianPerAcre;
    const msg = `Valued at ${usd(comps.subjectPerAcre)}/acre vs a median of ${usd(comps.medianPerAcre)}/acre across ${comps.count} nearby comparable parcels (${r >= 1 ? "+" : ""}${Math.round((r - 1) * 100)}%).`;
    if (r >= 1.25) out.push({ kind: "comparables", level: "strong", text: msg });
    else if (r >= 1.1) out.push({ kind: "comparables", level: "moderate", text: msg });
  }
  const d = daysUntilIso(p.protestDeadline, now);
  if (d != null && d >= 0 && d <= 45)
    out.push({ kind: "deadline", level: "moderate", text: `Protest deadline in ${d} days.` });
  if ((p.assessedValue ?? 0) >= 1e6 && !out.some((f) => f.level !== "info"))
    out.push({
      kind: "high_value",
      level: "info",
      text: "High-value commercial property — worth an assessment review.",
    });
  return out;
}

// ── Explained priority (High / Medium / Low) ────────────────────────────────
export type PriorityFactor = { label: string; points: number };
export type Ranking = {
  level: "high" | "medium" | "low";
  points: number;
  factors: PriorityFactor[];
  strongest: string | null;
};
/** Counties with county-wide data (prospecting or comparables) — more evidence to work with. */
export const DATA_COUNTIES = [
  "Harris",
  "Collin",
  "Denton",
  "Fort Bend",
  "Williamson",
  "Tarrant",
  "Travis",
  "Montgomery",
  "Grayson",
];

export function rankLead(
  l: Lead,
  props: LeadProperty[],
  activities: Activity[],
  now = new Date(),
): Ranking {
  if (["subscribed", "not_interested", "do_not_contact"].includes(l.stage))
    return {
      level: "low",
      points: 0,
      factors: [{ label: `Status: ${l.stage.replace(/_/g, " ")}`, points: 0 }],
      strongest: null,
    };
  const f: PriorityFactor[] = [];
  const add = (label: string, points: number) => points && f.push({ label, points });
  // assessment issues
  const flags = props.flatMap((p) => p.analysis?.flags ?? []);
  const strong = flags.filter((x) => x.level === "strong").length;
  const moderate = flags.filter((x) => x.level === "moderate" && x.kind !== "deadline").length;
  const maxUp = Math.max(-Infinity, ...props.map((p) => p.changePct ?? -Infinity));
  if (strong)
    add(`${strong} strong assessment concern${strong === 1 ? "" : "s"}`, Math.min(30, strong * 15));
  else if (maxUp >= 10) add(`Value up ${maxUp}% on last year`, 15);
  if (moderate)
    add(`${moderate} moderate concern${moderate === 1 ? "" : "s"}`, Math.min(16, moderate * 8));
  // value
  const v = l.portfolioValue ?? l.appraisedValue ?? 0;
  add(
    `Assessed ${usd(v)}`,
    v >= 100e6
      ? 35
      : v >= 25e6
        ? 30
        : v >= 5e6
          ? 22
          : v >= 2e6
            ? 15
            : v >= 1e6
              ? 10
              : v >= 5e5
                ? 5
                : 0,
  );
  // portfolio size
  const n = l.portfolioCount;
  add(`${n}-property portfolio`, n >= 10 ? 15 : n >= 5 ? 10 : n >= 3 ? 6 : n === 2 ? 3 : 0);
  // evidence available
  if (props.some((p) => (p.analysis?.comps?.count ?? 0) >= 3)) add("Comparable parcels on file", 5);
  if (props.some((p) => p.priorValue)) add("Value history on file", 3);
  // location: data coverage + deadline
  if (l.counties.some((c) => DATA_COUNTIES.includes(c)))
    add(`${l.counties.find((c) => DATA_COUNTIES.includes(c))} County — full county data`, 4);
  const d = daysUntilIso(l.protestDeadline, now);
  if (d != null && d >= 0 && d <= 45) add(`Protest deadline in ${d} days`, 10);
  // engagement + reachability
  if (l.stage === "interested") add("Said they're interested", 12);
  if (l.stage === "registration_started") add("Started registering", 6);
  if (l.stage === "registered") add("Has an account, no property yet", 8);
  if (l.stage === "property_added") add("Added a property, not subscribed", 12);
  if (l.stage === "subscription_started") add("Opened checkout", 16);
  if (l.stage === "no_response") add("No reply to outreach", -6);
  if (
    activities.some(
      (a) => a.leadId === l.id && (a.outcome === "replied" || a.outcome === "interested"),
    )
  )
    add("Replied to outreach", 5);
  if (l.email || l.phone) add("Reachable (email or phone)", 4);
  else add("No email or phone yet", -6);
  const points = f.reduce((s, x) => s + x.points, 0);
  const best = flags.find((x) => x.level === "strong") ?? flags.find((x) => x.level === "moderate");
  return {
    level: points >= 55 ? "high" : points >= 30 ? "medium" : "low",
    points,
    factors: f.sort((a, b) => b.points - a.points),
    strongest: best?.text ?? null,
  };
}
/** What the CRM shows: a staff-set priority wins over the ranking. */
export const shownPriority = (l: Lead, r: Ranking) =>
  l.fieldSources.priority?.source === "Staff" && l.priority ? l.priority : r.level;

// ── Protest deadlines ───────────────────────────────────────────────────────
/** Texas Tax Code §41.44: May 15, moved to the next business day when it falls on a weekend. */
export function statutoryDeadline(year: number): Date {
  const d = new Date(year, 4, 15, 12);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
/** The next protest season's statutory deadline. */
export function nextStatutoryDeadline(now = new Date()): Date {
  const d = statutoryDeadline(now.getFullYear());
  return now.getTime() > d.getTime() + 864e5 ? statutoryDeadline(now.getFullYear() + 1) : d;
}
export function deadlineInfo(l: Pick<Lead, "protestDeadline">, now = new Date()) {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (l.protestDeadline && new Date(`${l.protestDeadline}T23:59:59`) >= now)
    return {
      date: l.protestDeadline,
      label: fmt(new Date(`${l.protestDeadline}T12:00:00`)),
      basis: "notice" as const,
    };
  const d = nextStatutoryDeadline(now);
  return { date: d.toISOString().slice(0, 10), label: fmt(d), basis: "statutory" as const };
}

// ── County prospect lists + target groups ───────────────────────────────────
export type TargetGroup = {
  key: string;
  name: string;
  why: string;
  filters: LeadFilters;
  count: number;
};
export function countyTargets(
  d: MarketingData,
  county: string,
  priorityOf: (l: Lead) => "high" | "medium" | "low",
  now = new Date(),
): TargetGroup[] {
  const ctx = { activities: d.activities, campaigns: d.campaigns, me: d.me, priorityOf };
  const open: Stage[] = [
    "new",
    "researching",
    "ready",
    "contacted",
    "interested",
    "registered",
    "no_response",
  ];
  const base = { counties: [county], stages: open };
  const inCounty = applyFilters(d.leads, base, ctx, now);
  const types = new Map<string, number>();
  for (const l of inCounty) for (const t of l.propertyTypes) types.set(t, (types.get(t) ?? 0) + 1);
  const groups: Omit<TargetGroup, "count">[] = [
    {
      key: "high",
      name: "High priority",
      why: "Strongest assessment issues, value and portfolio",
      filters: { ...base, priority: "high" },
    },
    {
      key: "increase",
      name: "Assessment increases",
      why: "Assessed value up 5%+ on last year",
      filters: { ...base, minChangePct: 5 },
    },
    {
      key: "flagged",
      name: "Protest potential",
      why: "Properties the assessment review flagged",
      filters: { ...base, flaggedOnly: true },
    },
    {
      key: "portfolio",
      name: "Multi-property owners",
      why: "3+ properties — one conversation, several protests",
      filters: { ...base, minProperties: 3 },
    },
    {
      key: "5m",
      name: "$5M+ assessed",
      why: "Largest tax bills",
      filters: { ...base, minValue: 5e6 },
    },
    {
      key: "new",
      name: "Never contacted",
      why: "Researched, no outreach yet",
      filters: { ...base, engagement: "never_contacted" },
    },
    {
      key: "engaged",
      name: "Engaged",
      why: "Replied, interested or signed up",
      filters: { ...base, engagement: "engaged" },
    },
    ...[...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t]) => ({
        key: `type-${t}`,
        name: t,
        why: "Same property type — one tailored message",
        filters: { ...base, propertyTypes: [t] },
      })),
  ];
  return groups
    .map((g) => ({ ...g, count: applyFilters(d.leads, g.filters, ctx, now).length }))
    .filter((g) => g.count > 0);
}

/** Counties with leads, most leads first. */
export function leadCounties(leads: Lead[]): { county: string; n: number }[] {
  const m = new Map<string, number>();
  for (const l of leads)
    for (const c of l.counties.length ? l.counties : l.county ? [l.county] : [])
      m.set(c, (m.get(c) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([county, n]) => ({ county, n }));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function leadsCsv(
  leads: Lead[],
  d: Pick<MarketingData, "properties" | "staff">,
  priorityOf: (l: Lead) => string,
): string {
  const head = [
    "Owner / company",
    "Contact",
    "Email",
    "Phone",
    "Mailing address",
    "Status",
    "Priority",
    "Properties",
    "Total assessed",
    "Counties",
    "Top property",
    "Biggest value change %",
    "Protest deadline",
    "Deadline basis",
    "Next action",
    "Assigned to",
  ];
  const rows = leads.map((l) => {
    const dl = deadlineInfo(l);
    return [
      l.company ?? l.fullName ?? l.email,
      l.company ? l.fullName : "",
      l.unsubscribedAt || l.stage === "do_not_contact" ? "" : l.email,
      l.stage === "do_not_contact" ? "" : l.phone,
      l.mailingAddress,
      l.stage,
      priorityOf(l),
      l.portfolioCount,
      l.portfolioValue != null ? Math.round(l.portfolioValue) : "",
      l.counties.join("; "),
      l.propertyAddress,
      l.maxChangePct ?? "",
      dl.date,
      dl.basis === "notice" ? "From notice" : "Statutory (May 15 or 30 days after notice)",
      l.nextAction,
      d.staff.find((s) => s.id === l.assignedTo)?.name ?? "",
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// ── County prospecting results → leads ─────────────────────────────────────
export type ProspectRecord = {
  ownerName: string | null;
  propertyAddress: string;
  city: string | null;
  zip: string | null;
  county: string;
  cad: string;
  accountNumber: string | null;
  stateCode: string | null;
  propertyType: string;
  assessedValue: number | null;
  priorValue: number | null;
  valueYear: number | null;
  mailingAddress: string | null;
};
export type ProspectGroup = {
  key: string;
  owner: string;
  records: ProspectRecord[];
  total: number;
  maxChangePct: number | null;
  mailingAddress: string | null;
  existing: { leadId: string; name: string } | null;
  newRecords: ProspectRecord[];
  known: number;
};
/** One group per owner; flags owners already in the CRM and parcels already linked. */
export function groupProspects(
  records: ProspectRecord[],
  leads: Lead[],
  props: LeadProperty[],
): ProspectGroup[] {
  const linked = new Set(props.map((p) => p.dedupeKey));
  const byOwner = new Map<string, Lead>();
  for (const l of leads)
    for (const n of [l.company, l.ownerNames, l.fullName]) {
      const k = ownerKey(n);
      if (k.length > 3 && !byOwner.has(k)) byOwner.set(k, l);
    }
  const groups = new Map<string, ProspectGroup>();
  for (const r of records) {
    const k = ownerKey(r.ownerName) || r.accountNumber || r.propertyAddress;
    let g = groups.get(k);
    if (!g) {
      const ex = byOwner.get(k);
      g = {
        key: k,
        owner: tidyName(r.ownerName) ?? "Unknown owner",
        records: [],
        total: 0,
        maxChangePct: null,
        mailingAddress: r.mailingAddress,
        existing: ex ? { leadId: ex.id, name: leadName(ex) } : null,
        newRecords: [],
        known: 0,
      };
      groups.set(k, g);
    }
    g.records.push(r);
    g.total += r.assessedValue ?? 0;
    if (r.assessedValue && r.priorValue) {
      const up = Math.round((r.assessedValue / r.priorValue - 1) * 1000) / 10;
      g.maxChangePct = Math.max(g.maxChangePct ?? -Infinity, up);
    }
    const key = propertyKey({
      accountNumber: r.accountNumber,
      county: r.county,
      address: r.propertyAddress,
    });
    if (linked.has(key)) g.known++;
    else g.newRecords.push(r);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

// ── Templates ───────────────────────────────────────────────────────────────
/** Same tokens and fallbacks as personalize() in marketing-send.ts. */
export function personalize(text: string, l: Lead): string {
  const first = (l.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const n = l.portfolioCount;
  const dl = deadlineInfo(l);
  return text
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{name}}", l.fullName ?? "there")
    .replaceAll("{{company}}", l.company ?? l.fullName ?? "your company")
    .replaceAll("{{property_address}}", l.propertyAddress ?? "your property")
    .replaceAll("{{county}}", l.county ?? "your")
    .replaceAll("{{property_count}}", String(n || 1))
    .replaceAll(
      "{{portfolio_value}}",
      l.portfolioValue != null ? usd(l.portfolioValue) : "your properties",
    )
    .replaceAll(
      "{{value_change}}",
      l.maxChangePct != null && l.maxChangePct > 0 ? `${l.maxChangePct}%` : "noticeably",
    )
    .replaceAll(
      "{{protest_deadline}}",
      dl.basis === "notice" ? dl.label : "May 15 (or 30 days after your notice, if later)",
    )
    .replaceAll(
      "{{portfolio_note}}",
      n > 1 ? ` and your other ${n - 1} propert${n === 2 ? "y" : "ies"}` : "",
    );
}
export const TEMPLATE_TOKENS = [
  "{{first_name}}",
  "{{company}}",
  "{{property_address}}",
  "{{county}}",
  "{{property_count}}",
  "{{portfolio_value}}",
  "{{value_change}}",
  "{{protest_deadline}}",
];

/** The objective that fits this prospect right now, and why. */
export function pickObjective(
  l: Lead,
  activities: Activity[],
  now = new Date(),
): { objective: TemplateObjective; why: string } {
  const out = activities.filter(
    (a) => a.leadId === l.id && ["email", "sms", "call"].includes(a.kind),
  );
  const d = daysUntilIso(l.protestDeadline, now);
  if (l.stage === "registration_started")
    return { objective: "registration_reminder", why: "Started registering, didn't finish" };
  if (l.stage === "registered")
    return { objective: "add_property", why: "Registered, no property added yet" };
  if (l.stage === "property_added")
    return { objective: "subscription_promo", why: "Added a property, not subscribed yet" };
  if (l.stage === "subscription_started")
    return { objective: "finish_checkout", why: "Opened checkout but didn't finish" };
  if (l.stage === "interested")
    return { objective: "registration_reminder", why: "Interested — send the registration link" };
  if (l.source === "beta_signup" && !l.profileId)
    return { objective: "registration_reminder", why: "Signed up for the beta, no account yet" };
  if (d != null && d >= 0 && d <= 30)
    return { objective: "deadline", why: `Protest deadline in ${d} days` };
  const usedIncrease = activities.some(
    (a) => a.leadId === l.id && a.summary.toLowerCase().includes("increase"),
  );
  if ((l.maxChangePct ?? 0) >= 5 && !usedIncrease)
    return { objective: "assessment_increase", why: `Assessed value up ${l.maxChangePct}%` };
  if (!out.length) return { objective: "initial_outreach", why: "Not contacted yet" };
  return {
    objective: "follow_up",
    why: `${out.length} earlier touch${out.length === 1 ? "" : "es"}, no conversion yet`,
  };
}

/** Picks the best active template: right objective + channel, not already sent to them, then most used. */
export function pickTemplate(
  l: Lead,
  templates: Template[],
  activities: Activity[],
  channel: "email" | "sms",
  objective?: TemplateObjective,
): { template: Template | null; objective: TemplateObjective; why: string } {
  const auto = pickObjective(l, activities);
  const obj = objective ?? auto.objective;
  const sent = new Set(
    activities.filter((a) => a.leadId === l.id && a.templateId).map((a) => a.templateId),
  );
  const pool = templates
    .filter((t) => t.active && t.channel === channel && t.objective === obj)
    .sort(
      (a, b) =>
        Number(sent.has(a.id)) - Number(sent.has(b.id)) ||
        Number(a.isDefault) - Number(b.isDefault) ||
        b.uses - a.uses,
    );
  return {
    template: pool[0] ?? null,
    objective: obj,
    why: objective ? "Chosen objective" : auto.why,
  };
}

export type { AssessmentAnalysis };

/** Ranking for every lead at once (one pass over properties). */
export function rankAll(
  d: Pick<MarketingData, "leads" | "properties" | "activities">,
  now = new Date(),
) {
  const byLead = new Map<string, LeadProperty[]>();
  for (const p of d.properties) byLead.set(p.leadId, [...(byLead.get(p.leadId) ?? []), p]);
  const out = new Map<string, Ranking>();
  for (const l of d.leads) out.set(l.id, rankLead(l, byLead.get(l.id) ?? [], d.activities, now));
  return out;
}

// ── Registration → subscription journey ─────────────────────────────────────
export const JOURNEY = [
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "registration_started", label: "Registration Started" },
  { key: "registered", label: "Registered" },
  { key: "property_added", label: "Property Added" },
  { key: "subscription_started", label: "Subscription Started" },
  { key: "subscribed", label: "Subscribed" },
] as const;
export type JourneyKey = (typeof JOURNEY)[number]["key"];
const ORDER: Record<string, number> = {
  new: -1,
  researching: -1,
  ready: -1,
  no_response: 0,
  not_interested: 0,
  do_not_contact: 0,
  contacted: 0,
  interested: 1,
  registration_started: 2,
  registered: 3,
  property_added: 4,
  subscription_started: 5,
  subscribed: 6,
};

/** Which journey steps a lead has reached, with when (where the account tells us). */
export function journeySteps(l: Lead, activities: Activity[]) {
  const reached = ORDER[l.stage] ?? -1;
  const mine = activities.filter((a) => a.leadId === l.id);
  const contactedAt =
    l.lastContactedAt ??
    mine.filter((a) => ["email", "sms", "call", "meeting"].includes(a.kind)).at(-1)?.createdAt ??
    null;
  const interestedAt =
    mine
      .filter(
        (a) =>
          a.outcome === "interested" || (a.kind === "stage" && a.summary.endsWith("Interested")),
      )
      .at(-1)?.createdAt ?? null;
  const at: Record<JourneyKey, string | null> = {
    contacted: contactedAt,
    interested: interestedAt,
    registration_started: l.registrationStartedAt,
    registered: l.registeredAt,
    property_added: l.propertyAddedAt,
    subscription_started: l.subscriptionStartedAt,
    subscribed: l.subscribedAt,
  };
  return JOURNEY.map((s, i) => ({
    ...s,
    at: at[s.key],
    // people who signed up on their own count the marketing steps as passed
    done: !!at[s.key] || reached >= i || (i <= 1 && reached >= 2),
    current: reached === i,
  }));
}

/** How many leads reached each step, and where they drop off. */
export function journeyFunnel(leads: Lead[], activities: Activity[]) {
  const counts = JOURNEY.map(() => 0);
  for (const l of leads) journeySteps(l, activities).forEach((s, i) => s.done && counts[i]++);
  return JOURNEY.map((s, i) => ({
    ...s,
    count: counts[i],
    /** share of the previous step that made it here */
    conversion: i === 0 ? null : counts[i - 1] ? counts[i] / counts[i - 1] : null,
    stuck: leads.filter((l) => l.stage === s.key).length,
  }));
}

/** Links that take a prospect straight back to the step they haven't finished. */
export function journeyLinks(l: Pick<Lead, "email" | "fullName" | "inviteToken">, site: string) {
  const q = new URLSearchParams({ mode: "signup" });
  if (l.email) q.set("email", l.email);
  const first = (l.fullName ?? "").trim().split(/\s+/)[0];
  if (first) q.set("firstName", first);
  if (l.inviteToken) q.set("lead", l.inviteToken);
  return {
    registration: `${site}/sign-in?${q}`,
    addProperty: `${site}/dashboard/properties`,
    checkout: `${site}/dashboard/properties`,
  };
}

// ── Best timing + channel ───────────────────────────────────────────────────
export type Timing = { channel: "email" | "call" | "sms"; at: Date; why: string };
const nextWeekday = (from: Date, hour: number) => {
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
};
/**
 * When and how to reach this lead next: the channel they've answered on, at
 * the hour they usually reply (else mid-morning), sooner for hot journey
 * steps and high priority, Tue–Thu for routine touches.
 */
export function bestTiming(
  l: Lead,
  activities: Activity[],
  priority: "high" | "medium" | "low",
  now = new Date(),
): Timing {
  const mine = activities.filter((a) => a.leadId === l.id);
  const replies = mine.filter((a) => a.outcome === "replied" || a.outcome === "interested");
  const emailsOut = mine.filter((a) => a.kind === "email").length;
  let channel: Timing["channel"];
  let why: string;
  const repliedOn = replies[0]?.kind;
  if (repliedOn === "call" && l.phone) [channel, why] = ["call", "They've answered calls before"];
  else if (repliedOn === "email" && l.email)
    [channel, why] = ["email", "They've replied to email before"];
  else if (emailsOut >= 1 && l.phone && !replies.length)
    [channel, why] = ["call", "Emails went unanswered — try the phone"];
  else if (
    ["interested", "registration_started", "subscription_started"].includes(l.stage) &&
    l.phone
  )
    [channel, why] = ["call", "Hot step — a quick call converts best"];
  else if (l.email && !l.unsubscribedAt) [channel, why] = ["email", "Email first"];
  else if (l.phone) [channel, why] = ["call", "No email on file"];
  else [channel, why] = ["email", "No contact details yet"];
  const hours = replies
    .map((a) => new Date(a.createdAt).getHours())
    .filter((h) => h >= 8 && h <= 18);
  const hour = hours.length ? Math.round(hours.reduce((s, h) => s + h, 0) / hours.length) : 10;
  if (hours.length)
    why += ` · around ${hour % 12 || 12}${hour < 12 ? "am" : "pm"}, when they usually reply`;
  const hot = ["interested", "registration_started", "subscription_started"].includes(l.stage);
  let at = nextWeekday(now, hour);
  if (!hot && priority !== "high") {
    for (let i = 0; i < 7 && ![2, 3, 4].includes(at.getDay()); i++) at = nextWeekday(at, hour);
    why += " · routine touch, Tue–Thu";
  } else
    why += hot ? " · hot step — next business morning" : " · high priority — next business morning";
  return { channel, at, why };
}

// ── AI follow-up queue ──────────────────────────────────────────────────────
export type QueueItem = {
  lead: Lead;
  reason: string;
  kind:
    | "no_response"
    | "interested"
    | "registration"
    | "property"
    | "subscribe"
    | "checkout"
    | "more_properties"
    | "quiet";
  objective: TemplateObjective;
  timing: Timing;
  priority: "high" | "medium" | "low";
  potential: number;
};
const STEP_WEIGHT: Record<QueueItem["kind"], number> = {
  checkout: 40,
  subscribe: 30,
  interested: 28,
  registration: 25,
  property: 22,
  more_properties: 18,
  no_response: 10,
  quiet: 8,
};
/** Prospects who need a follow-up now, highest conversion potential first. */
export function followupQueue(
  d: MarketingData,
  ranks: Map<string, Ranking>,
  now = new Date(),
): QueueItem[] {
  const out: QueueItem[] = [];
  const ago = (iso: string | null | undefined) =>
    iso ? (now.getTime() - new Date(iso).getTime()) / 864e5 : Infinity;
  const accountProps = new Map<string, number>();
  for (const p of d.properties)
    if (p.source === "account") accountProps.set(p.leadId, (accountProps.get(p.leadId) ?? 0) + 1);
  for (const l of d.leads) {
    if (["do_not_contact", "not_interested", "subscribed"].includes(l.stage)) continue;
    if (
      d.followups.some((f) => f.leadId === l.id && (f.status === "pending" || f.status === "draft"))
    )
      continue;
    const mine = d.activities.filter((a) => a.leadId === l.id);
    const lastOut = mine.find((a) => ["email", "sms", "call", "meeting"].includes(a.kind));
    const replied = mine.some((a) => a.outcome === "replied" || a.outcome === "interested");
    const added = accountProps.get(l.id) ?? 0;
    let item: Pick<QueueItem, "reason" | "kind" | "objective"> | null = null;
    if (l.stage === "subscription_started" && ago(l.subscriptionStartedAt) > 2 / 24)
      item = {
        kind: "checkout",
        reason: "Opened checkout but didn't finish",
        objective: "finish_checkout",
      };
    else if (l.stage === "property_added" && l.portfolioCount > added + 1)
      item = {
        kind: "more_properties",
        reason: `Owns ${l.portfolioCount} properties, added ${added} — offer the spreadsheet upload`,
        objective: "add_property",
      };
    else if (l.stage === "property_added" && ago(l.propertyAddedAt) > 2)
      item = {
        kind: "subscribe",
        reason: "Added a property, hasn't subscribed",
        objective: "subscription_promo",
      };
    else if (l.stage === "registered" && ago(l.registeredAt) > 1)
      item = {
        kind: "property",
        reason: "Registered, hasn't added a property",
        objective: "add_property",
      };
    else if (l.stage === "registration_started" && ago(l.registrationStartedAt) > 1)
      item = {
        kind: "registration",
        reason: "Started registering, didn't finish",
        objective: "registration_reminder",
      };
    else if (l.stage === "interested" && ago(lastOut?.createdAt) > 2)
      item = {
        kind: "interested",
        reason: "Interested, hasn't registered",
        objective: "registration_reminder",
      };
    else if (
      ["contacted", "no_response"].includes(l.stage) &&
      !replied &&
      ago(lastOut?.createdAt) > 3
    )
      item = {
        kind: "no_response",
        reason: `No reply ${Math.round(ago(lastOut?.createdAt))} days after the last ${lastOut?.kind ?? "message"}`,
        objective: "follow_up",
      };
    else if (l.stage === "ready" && !lastOut)
      item = {
        kind: "quiet",
        reason: "Ready for outreach, never contacted",
        objective: "initial_outreach",
      };
    if (!item) continue;
    const r = ranks.get(l.id);
    const priority = r ? shownPriority(l, r) : "medium";
    out.push({
      lead: l,
      ...item,
      timing: bestTiming(l, d.activities, priority, now),
      priority,
      potential: (r?.points ?? 0) + STEP_WEIGHT[item.kind],
    });
  }
  return out.sort((a, b) => b.potential - a.potential);
}

// ── Follow-up effectiveness ─────────────────────────────────────────────────
export type Effectiveness = {
  outreach: number;
  responses: number;
  responseRate: number | null;
  byChannel: { key: string; sent: number; responded: number; rate: number | null }[];
  byTemplate: { key: string; sent: number; responded: number; rate: number | null }[];
  overdue: number;
  onTime: number | null;
  registrations: number;
  abandoned: { registration: number; property: number; checkout: number };
  conversions: number;
};
/**
 * A touch "worked" when, within 7 days, the lead replied / said interested or
 * moved forward a journey step. Window: the last `days` days.
 */
export function effectiveness(d: MarketingData, days = 30, now = new Date()): Effectiveness {
  const since = now.getTime() - days * 864e5;
  const touches = d.activities.filter(
    (a) =>
      a.leadId &&
      ["email", "sms", "call", "meeting"].includes(a.kind) &&
      new Date(a.createdAt).getTime() >= since,
  );
  const byLead = new Map<string, Activity[]>();
  for (const a of d.activities)
    if (a.leadId) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a]);
  const forward =
    /→ (Interested|Registration Started|Registered|Property Added|Subscription Started|Subscribed)$/;
  const worked = (t: Activity) => {
    const t0 = new Date(t.createdAt).getTime();
    return (byLead.get(t.leadId!) ?? []).some((a) => {
      const ts = new Date(a.createdAt).getTime();
      if (ts <= t0 || ts > t0 + 7 * 864e5) return false;
      return (
        a.outcome === "replied" ||
        a.outcome === "interested" ||
        (a.kind === "stage" && forward.test(a.summary))
      );
    });
  };
  const rate = (n: number, of: number) => (of ? n / of : null);
  const group = (key: (a: Activity) => string | null) => {
    const m = new Map<string, { sent: number; responded: number }>();
    for (const t of touches) {
      const k = key(t);
      if (!k) continue;
      const g = m.get(k) ?? { sent: 0, responded: 0 };
      g.sent++;
      if (worked(t)) g.responded++;
      m.set(k, g);
    }
    return [...m.entries()].map(([k, g]) => ({ key: k, ...g, rate: rate(g.responded, g.sent) }));
  };
  const responses = touches.filter(worked).length;
  const doneFu = d.followups.filter(
    (f) => f.status === "done" && f.completedAt && new Date(f.completedAt).getTime() >= since,
  );
  const recent = (iso: string | null) => !!iso && new Date(iso).getTime() >= since;
  const old = (iso: string | null, hours: number) =>
    !!iso && now.getTime() - new Date(iso).getTime() > hours * 36e5;
  return {
    outreach: touches.length,
    responses,
    responseRate: rate(responses, touches.length),
    byChannel: group((a) => a.kind),
    byTemplate: group((a) => a.templateId),
    overdue: d.followups.filter((f) => f.status === "pending" && new Date(f.dueAt) < now).length,
    onTime: rate(
      doneFu.filter(
        (f) => new Date(f.completedAt!).getTime() <= new Date(f.dueAt).getTime() + 864e5,
      ).length,
      doneFu.length,
    ),
    registrations: d.leads.filter((l) => recent(l.registeredAt)).length,
    abandoned: {
      registration: d.leads.filter(
        (l) => l.stage === "registration_started" && old(l.registrationStartedAt, 24),
      ).length,
      property: d.leads.filter((l) => l.stage === "registered" && old(l.registeredAt, 72)).length,
      checkout: d.leads.filter(
        (l) => l.stage === "subscription_started" && old(l.subscriptionStartedAt, 2),
      ).length,
    },
    conversions: d.leads.filter((l) => recent(l.subscribedAt)).length,
  };
}
