import directory from "../data/tx-cad-directory.json";
import { countyFromCad } from "./tax-rates-official";
import {
  BPP_RENDITION_SCHEMA,
  getBppRenditionDefaults,
  getIncompleteRequiredLabels,
} from "./protest-documents";
import { parseNumber } from "./csv-import";

// "Property/Business Address" → "propertybusinessaddress"
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "");
import type { SpreadsheetGrid } from "./spreadsheet-import";
import {
  nextBppRenditionDeadline,
  type BppAccountRecord,
  type BppSource,
  type RenditionAsset,
  type RenditionValues,
} from "./bpp-accounts";

// The Personal Property tab's logic, apart from the UI
// (routes/dashboard/_layout.bpp-accounts.tsx, components/BppRenditionEditor.tsx):
// statuses, what's missing, duplicate checks, the CSV template and the asset
// schedule. Nothing here submits, files or pays anything.

// ---- counties --------------------------------------------------------------

const counties = Object.values(
  (
    directory as unknown as {
      counties: Record<string, { county: string; appraisalDistrict: { name: string } | null }>;
    }
  ).counties,
);

export const TX_COUNTIES: string[] = counties.map((c) => c.county).sort();

// "Bexar" → "Bexar Appraisal District" (the Comptroller's name for it).
export function cadForCounty(county: string): string {
  const c = counties.find((x) => x.county.toLowerCase() === county.trim().toLowerCase());
  return c?.appraisalDistrict?.name ?? `${county.trim()} Appraisal District`;
}

// "Bexar Appraisal District" → "Bexar"
export function countyOf(cad: string | null | undefined): string {
  const lower = countyFromCad(cad);
  if (!lower) return cad ?? "";
  return TX_COUNTIES.find((c) => c.toLowerCase() === lower) ?? cad ?? "";
}

// ---- statuses ---------------------------------------------------------------

export type BppRenditionStatus =
  "not_started" | "in_progress" | "ready_to_sign" | "signed" | "submitted";

export const RENDITION_STATUS_LABEL: Record<BppRenditionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  ready_to_sign: "Ready to sign",
  signed: "Signed — not submitted",
  submitted: "Submitted",
};

export function renditionStatus(a: BppAccountRecord): BppRenditionStatus {
  if (a.renditionFiledAt) return "submitted";
  if (a.renditionSignedAt) return "signed";
  const v = a.renditionValues;
  if (!v) return "not_started";
  if (renditionMissing(a, { ...v, fields: renditionFieldValues(a) }).length === 0)
    return "ready_to_sign";
  return "in_progress";
}

// The rendition deadline that applies: a GRANTED extension replaces April 15;
// a request alone never does.
export function effectiveRenditionDeadline(a: BppAccountRecord): {
  date: string;
  basis: "extension" | "standard";
} {
  if (a.extensionGrantedUntil) return { date: a.extensionGrantedUntil, basis: "extension" };
  return { date: a.renditionDeadline ?? nextBppRenditionDeadline(), basis: "standard" };
}

export function daysUntil(iso: string, now = new Date()): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

// ---- the form ---------------------------------------------------------------

// What still has to be filled in before signing — the form's required fields
// plus the asset schedule and the certification.
export function renditionMissing(a: Pick<BppAccountRecord, "cad">, v: RenditionValues): string[] {
  const out = getIncompleteRequiredLabels(BPP_RENDITION_SCHEMA, v.fields ?? {});
  if (!a.cad) out.push("County / appraisal district");
  const approved = (v.assets ?? []).filter((x) => x.approved);
  if ((v.assets ?? []).some((x) => !x.approved))
    out.push("Review the assets Corvus AI found (approve or remove each)");
  if (approved.some((x) => x.cost == null && x.marketValue == null))
    out.push("A cost or market value for every approved asset");
  if (!v.certified) out.push("The certification that the information is true and correct");
  return out;
}

const ROW = (r: number) => ({
  desc: `ScA:General Property Description by TypeCategoryRow${r}`,
  qty: `ScA:Estimate of Quantity of Each TypeRow${r}`,
  value: `ScA:Good Faith Estimate of Market ValueRow${r}`,
  cost: `ScA:Historical Cost When NewRow${r}`,
  year: `ScA:Year AcquiredRow${r}`,
});

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Form 50-144 Schedule A has three rows: approved assets are grouped by
// category, the two largest get rows 1–2 and everything else is summed into
// row 3. Also sets the under/over $20,000 answer from the total.
export function scheduleAFields(assets: RenditionAsset[]): Record<string, string> {
  const approved = assets.filter((a) => a.approved);
  if (approved.length === 0) return {};
  const groups = new Map<string, RenditionAsset[]>();
  for (const a of approved) {
    const k = a.category.trim() || "Furniture, fixtures & equipment";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const value = (g: RenditionAsset[]) => g.reduce((s, a) => s + (a.marketValue ?? a.cost ?? 0), 0);
  const sorted = [...groups.entries()].sort((x, y) => value(y[1]) - value(x[1]));
  const rows =
    sorted.length <= 3
      ? sorted
      : [
          ...sorted.slice(0, 2),
          [
            `Other: ${sorted
              .slice(2)
              .map(([k]) => k)
              .join(", ")}`,
            sorted.slice(2).flatMap(([, g]) => g),
          ] as [string, RenditionAsset[]],
        ];
  const out: Record<string, string> = {};
  for (let i = 1; i <= 3; i++) {
    const r = ROW(i);
    const row = rows[i - 1];
    out[r.desc] = row ? row[0] : "";
    out[r.qty] = row ? String(row[1].length) : "";
    out[r.value] = row ? fmt(value(row[1])) : "";
    const cost = row ? row[1].reduce((s, a) => s + (a.cost ?? 0), 0) : 0;
    out[r.cost] = row && cost > 0 ? fmt(cost) : "";
    const years = row ? row[1].map((a) => a.year).filter((y): y is number => y != null) : [];
    out[r.year] = years.length
      ? Math.min(...years) === Math.max(...years)
        ? String(years[0])
        : `${Math.min(...years)}–${Math.max(...years)}`
      : "";
  }
  const total = approved.reduce((s, a) => s + (a.marketValue ?? a.cost ?? 0), 0);
  out["Total market value of your property"] = total < 20_000 ? "under $20,000" : "$20,000 or more";
  return out;
}

// Everything that goes on the PDF: defaults from the account, what the owner
// saved, and Schedule A from approved assets.
export function renditionFieldValues(a: BppAccountRecord): Record<string, string | boolean> {
  const v = a.renditionValues;
  const base = { ...getBppRenditionDefaults(a), ...(v?.fields ?? {}) };
  return (v?.assets ?? []).some((x) => x.approved)
    ? { ...base, ...scheduleAFields(v!.assets!) }
    : base;
}

export function assetTotal(assets: RenditionAsset[]): number {
  return assets.filter((a) => a.approved).reduce((s, a) => s + (a.marketValue ?? a.cost ?? 0), 0);
}

// The first {...} or [...] in a model reply (it sometimes wraps JSON in prose
// or a code fence).
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseNumber(v) ?? null;
  return null;
};

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

// Assets from a model reply: [{description, category, year, cost, marketValue}].
// Every one comes back UNAPPROVED — the owner reviews each before it counts.
export function assetsFromAi(text: string, source: string): RenditionAsset[] {
  const parsed = extractJson<unknown>(text);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { assets?: unknown }).assets)
      ? (parsed as { assets: unknown[] }).assets
      : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: newId(),
      description: String(x.description ?? "").trim(),
      category: String(x.category ?? "").trim() || "Furniture, fixtures & equipment",
      year: num(x.year),
      cost: num(x.cost),
      marketValue: num(x.marketValue),
      source,
      approved: false,
    }))
    .filter((a) => a.description);
}

// A fixed-asset report / depreciation schedule read as a spreadsheet — the
// common column names, no AI needed. null when the columns aren't recognisable.
const ASSET_COLS: Record<string, "description" | "category" | "year" | "cost" | "marketValue"> = {
  description: "description",
  assetdescription: "description",
  asset: "description",
  assetname: "description",
  item: "description",
  name: "description",
  category: "category",
  assetclass: "category",
  class: "category",
  type: "category",
  assettype: "category",
  year: "year",
  yearacquired: "year",
  acquired: "year",
  dateacquired: "year",
  acquisitiondate: "year",
  placedinservice: "year",
  inservicedate: "year",
  cost: "cost",
  originalcost: "cost",
  historicalcost: "cost",
  acquisitioncost: "cost",
  basis: "cost",
  costbasis: "cost",
  marketvalue: "marketValue",
  value: "marketValue",
  netbookvalue: "marketValue",
  bookvalue: "marketValue",
  nbv: "marketValue",
  fairmarketvalue: "marketValue",
};

export function assetsFromGrid(grid: SpreadsheetGrid, source: string): RenditionAsset[] | null {
  const idx: Partial<Record<keyof typeof ASSET_COLS | string, number>> = {};
  grid.headers.forEach((h, i) => {
    const f = ASSET_COLS[normalizeHeader(h)];
    if (f && idx[f] === undefined) idx[f] = i;
  });
  if (idx.description === undefined || (idx.cost === undefined && idx.marketValue === undefined))
    return null;
  const yearOf = (s: string) => {
    const m = s.match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  };
  return grid.rows
    .map((r) => ({
      id: newId(),
      description: r[idx.description!]?.trim() ?? "",
      category:
        (idx.category !== undefined ? r[idx.category] : "")?.trim() ||
        "Furniture, fixtures & equipment",
      year: idx.year !== undefined ? yearOf(r[idx.year] ?? "") : null,
      cost: idx.cost !== undefined ? num(r[idx.cost]) : null,
      marketValue: idx.marketValue !== undefined ? num(r[idx.marketValue]) : null,
      source,
      approved: false,
    }))
    .filter((a) => a.description && !/^total/i.test(a.description));
}

// ---- adding accounts ----------------------------------------------------------

export type BppCandidate = {
  key: string;
  businessName: string;
  locationAddress: string;
  county: string;
  accountNumber: string;
  taxYear: number | null;
  propertyId: string | null;
  source: BppSource;
  podioItemId?: string | null;
  // why it was suggested (identify-from-properties) or where it came from
  note?: string;
  include: boolean;
};

let cseq = 0;
export function newCandidate(
  source: BppSource,
  over: Partial<Omit<BppCandidate, "key" | "source">> = {},
): BppCandidate {
  return {
    key: `c${(cseq++).toString(36)}`,
    businessName: "",
    locationAddress: "",
    county: "",
    accountNumber: "",
    taxYear: new Date().getFullYear(),
    propertyId: null,
    include: true,
    ...over,
    source,
  };
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|lp|llp|co|corp|corporation|company|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");

const addrLine = (s: string | null | undefined) => norm((s ?? "").split(",")[0]);

// The existing account (or an earlier row in the same batch) this one repeats:
// the same CAD account number, or the same business at the same address for
// the same tax year.
export function findDuplicate(
  existing: Pick<
    BppAccountRecord,
    "id" | "businessName" | "accountNumber" | "locationAddress" | "taxYear"
  >[],
  c: Pick<BppCandidate, "businessName" | "accountNumber" | "locationAddress" | "taxYear">,
): string | null {
  const acct = norm(c.accountNumber);
  for (const e of existing) {
    if (acct && norm(e.accountNumber) === acct && (e.taxYear ?? c.taxYear) === c.taxYear)
      return e.id;
    if (
      norm(e.businessName) === norm(c.businessName) &&
      addrLine(e.locationAddress) === addrLine(c.locationAddress) &&
      (e.taxYear ?? null) === (c.taxYear ?? null)
    )
      return e.id;
  }
  return null;
}

export function candidateMissing(c: BppCandidate): string[] {
  const out: string[] = [];
  if (!c.businessName.trim()) out.push("business name");
  if (!c.locationAddress.trim()) out.push("address");
  if (!c.county.trim()) out.push("county");
  if (!c.taxYear) out.push("tax year");
  return out;
}

// Duplicates within the batch and against what's already saved.
export function candidateIssues(
  existing: Pick<
    BppAccountRecord,
    "id" | "businessName" | "accountNumber" | "locationAddress" | "taxYear"
  >[],
  batch: BppCandidate[],
): Map<string, { duplicate: "saved" | "batch" | null; missing: string[] }> {
  const out = new Map<string, { duplicate: "saved" | "batch" | null; missing: string[] }>();
  const seen: {
    id: string;
    businessName: string;
    accountNumber: string;
    locationAddress: string;
    taxYear: number | null;
  }[] = [];
  for (const c of batch) {
    const dup = findDuplicate(existing, c) ? "saved" : findDuplicate(seen, c) ? "batch" : null;
    out.set(c.key, { duplicate: dup, missing: candidateMissing(c) });
    if (c.include) seen.push({ id: c.key, ...c });
  }
  return out;
}

// The CorvusPT property at this address, if any.
export function matchPropertyByAddress<T extends { id: string; address: string }>(
  properties: T[],
  address: string | null | undefined,
): T | null {
  const line = addrLine(address);
  if (line.length < 5) return null;
  return properties.find((p) => addrLine(p.address) === line) ?? null;
}

// ---- CSV ------------------------------------------------------------------------

export type BppCsvField =
  "businessName" | "locationAddress" | "county" | "accountNumber" | "taxYear" | "ignore";

export const BPP_CSV_FIELD_LABEL: Record<BppCsvField, string> = {
  businessName: "Business Name",
  locationAddress: "Property / Business Address",
  county: "County",
  accountNumber: "CAD Account Number",
  taxYear: "Tax Year",
  ignore: "— ignore —",
};

const CSV_ALIASES: Record<string, BppCsvField> = {
  businessname: "businessName",
  business: "businessName",
  company: "businessName",
  companyname: "businessName",
  name: "businessName",
  dba: "businessName",
  owner: "businessName",
  ownername: "businessName",
  address: "locationAddress",
  propertyaddress: "locationAddress",
  businessaddress: "locationAddress",
  propertybusinessaddress: "locationAddress",
  location: "locationAddress",
  locationaddress: "locationAddress",
  situs: "locationAddress",
  situsaddress: "locationAddress",
  county: "county",
  cad: "county",
  appraisaldistrict: "county",
  accountnumber: "accountNumber",
  cadaccountnumber: "accountNumber",
  account: "accountNumber",
  accountno: "accountNumber",
  bppaccount: "accountNumber",
  propertyid: "accountNumber",
  taxyear: "taxYear",
  year: "taxYear",
};

export function bppColumnMapping(headers: string[]): BppCsvField[] {
  const used = new Set<BppCsvField>();
  return headers.map((h) => {
    const f = CSV_ALIASES[normalizeHeader(h)];
    if (!f || used.has(f)) return "ignore";
    used.add(f);
    return f;
  });
}

// "Bexar County", "Bexar CAD", "Bexar Appraisal District" → "Bexar"
export function normalizeCounty(raw: string): string {
  const s = raw
    .replace(/\b(county|central|appraisal|district|cad|tx|texas)\b/gi, "")
    .replace(/[^a-z\s]/gi, "")
    .trim();
  return TX_COUNTIES.find((c) => c.toLowerCase() === s.toLowerCase()) ?? raw.trim();
}

export function candidatesFromGrid(
  grid: SpreadsheetGrid,
  mapping: BppCsvField[],
  source: BppSource,
): BppCandidate[] {
  const col = (f: BppCsvField) => mapping.indexOf(f);
  const get = (r: string[], f: BppCsvField) => (col(f) >= 0 ? (r[col(f)] ?? "").trim() : "");
  return grid.rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const y = Number(get(r, "taxYear").match(/\d{4}/)?.[0] ?? NaN);
      return newCandidate(source, {
        businessName: get(r, "businessName"),
        locationAddress: get(r, "locationAddress"),
        county: get(r, "county") ? normalizeCounty(get(r, "county")) : "",
        accountNumber: get(r, "accountNumber"),
        taxYear: Number.isFinite(y) ? y : null,
      });
    });
}

export const BPP_CSV_TEMPLATE = [
  "Business Name,Property/Business Address,County,CAD Account Number,Tax Year",
  `Acme Coffee LLC,"1234 Main St, San Antonio, TX 78205",Bexar,,${new Date().getFullYear()}`,
  `Acme Coffee LLC,"500 Elm St, Dallas, TX 75201",Dallas,98765432,${new Date().getFullYear()}`,
].join("\r\n");

export function downloadBppCsvTemplate(): void {
  const blob = new Blob([BPP_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "corvuspt-personal-property-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- submission ----------------------------------------------------------------

export const SUBMISSION_METHOD_LABEL: Record<string, string> = {
  online: "Online portal",
  email: "Email",
  mail: "Mail",
  in_person: "In person",
  other: "Other",
};

// A mailto: link with the rendition summary for counties that accept email.
// The owner attaches the signed PDF and sends it themselves.
export function renditionEmailLink(
  to: string,
  a: Pick<BppAccountRecord, "businessName" | "accountNumber" | "taxYear" | "locationAddress">,
): string {
  const year = a.taxYear ?? new Date().getFullYear();
  const subject = `${year} Business Personal Property Rendition — ${a.businessName}${a.accountNumber ? ` (Acct ${a.accountNumber})` : ""}`;
  const body = [
    "Hello,",
    "",
    `Please find attached the ${year} Business Personal Property Rendition (Form 50-144) for:`,
    "",
    `Business: ${a.businessName}`,
    a.accountNumber ? `Account number: ${a.accountNumber}` : null,
    a.locationAddress ? `Location: ${a.locationAddress}` : null,
    "",
    "Please confirm receipt.",
    "",
    "Thank you.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
