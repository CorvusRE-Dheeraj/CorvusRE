// Pure helpers for sync-city-code-cases: which open city code cases belong
// to a property, and how each one becomes a property_issues row. No Deno
// APIs, so the app's vitest suite imports it directly.
//
// Sources (public Socrata APIs, no key needed):
// - Austin Code Enforcement cases — data.austintexas.gov 6wtj-zbtb
//   (case_id, house_number, street_name, opened_date, closed_date,
//   description, inspector "Name|phone").
// - Dallas 311 service requests, Code Compliance department —
//   www.dallasopendata.com d7e7-envw (service_request_number, address
//   "847 BROOKHURST DR, DALLAS, TX, 75218", service_request_type, status,
//   created_date, overall_service_request_due_date).
// Fort Worth moved its code data to ArcGIS and Houston/San Antonio publish no
// per-address feed, so other cities rely on the owner uploading the notice.

import type { IssueCategoryId } from "./property-issue.ts";

export const AUSTIN_CASES_URL =
  "https://data.austintexas.gov/resource/6wtj-zbtb.json";
export const DALLAS_311_URL =
  "https://www.dallasopendata.com/resource/d7e7-envw.json";

export type CityId = "austin" | "dallas";

export type AddressKey = {
  city: CityId;
  houseNumber: string;
  streetPrefix: string;
};

const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

// "7212 Vicenza Dr, Austin, TX 78652" → { austin, "7212", "VICENZA" }.
// Null for cities without a feed or an address we can't key safely.
export function addressKey(address: string): AddressKey | null {
  const parts = address
    .toUpperCase()
    .split(",")
    .map((p) => p.trim());
  const cityPart = parts.slice(1).join(" ");
  const city: CityId | null = /\bAUSTIN\b/.test(cityPart)
    ? "austin"
    : /\bDALLAS\b/.test(cityPart)
      ? "dallas"
      : null;
  if (!city) return null;
  const tokens = parts[0]
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const houseNumber = tokens[0];
  if (!houseNumber || !/^\d+$/.test(houseNumber) || tokens.length < 2)
    return null;
  // Keep a leading directional with the street name ("S MALCOLM") — the
  // house number plus the first real word is specific enough.
  const street =
    DIRECTIONALS.has(tokens[1]) && tokens[2]
      ? `${tokens[1]} ${tokens[2]}`
      : tokens[1];
  return { city, houseNumber, streetPrefix: street };
}

const soql = (s: string) => s.replace(/'/g, "''");

// The Socrata query for open cases at this address, opened within the last year.
export function caseQuery(
  key: AddressKey,
  sinceIso: string,
): { url: string; params: Record<string, string> } {
  if (key.city === "austin") {
    return {
      url: AUSTIN_CASES_URL,
      params: {
        $where: `house_number='${soql(key.houseNumber)}' AND starts_with(street_name, '${soql(key.streetPrefix)}') AND closed_date IS NULL AND opened_date >= '${sinceIso}'`,
        $limit: "50",
      },
    };
  }
  return {
    url: DALLAS_311_URL,
    params: {
      $where: `department='Code Compliance' AND starts_with(address, '${soql(`${key.houseNumber} ${key.streetPrefix}`)}') AND status != 'Closed' AND created_date >= '${sinceIso}'`,
      $limit: "50",
    },
  };
}

export type CaseIssue = {
  externalRef: string;
  category: IssueCategoryId;
  title: string;
  description: string;
  issuedOn: string | null;
  deadline: string | null;
  authority: string;
  authorityContact: string | null;
};

const day = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

const AUSTIN_CATEGORY: Record<string, IssueCategoryId> = {
  "property abatement": "maintenance",
  "structure condition violation(s)": "maintenance",
  "land use violation(s)": "code_offense",
  "work without permit": "code_offense",
};

export function austinCaseToIssue(
  row: Record<string, unknown>,
): CaseIssue | null {
  const ref = typeof row.case_id === "string" ? row.case_id.trim() : "";
  if (!ref) return null;
  const desc = String(row.description ?? "Code case").trim();
  const [inspector, phone] = String(row.inspector ?? "")
    .split("|")
    .map((s) => s.trim());
  return {
    externalRef: `austin:${ref}`,
    category: AUSTIN_CATEGORY[desc.toLowerCase()] ?? "code_offense",
    title: `City of Austin code case — ${desc}`,
    description: `Austin Code Enforcement case ${ref} (${String(row.case_type ?? "Complaint")}, status ${String(row.status ?? "open")}). Found in the City of Austin's public code case records.`,
    issuedOn: day(row.opened_date),
    deadline: null,
    authority: "City of Austin Code Enforcement",
    authorityContact:
      [inspector && `Inspector ${inspector}`, phone, "311 / (512) 974-2000"]
        .filter(Boolean)
        .join(" · ") || null,
  };
}

// Dallas 311 request types that are about the property itself (the rest of
// Code Compliance's queue is food, mosquito and similar complaints).
const DALLAS_TYPES: Record<string, IssueCategoryId> = {
  "code concern - ccs": "code_offense",
  "illegal dumping sign - ccs": "dumping",
  "single family rental needs registration - ccs": "compliance_deadline",
  "boarding home complaint - ccs": "code_offense",
  "short term/vacation rental survey - ccs": "compliance_deadline",
  "commercial pool complaint - ccs": "maintenance",
};

export function dallasCaseToIssue(
  row: Record<string, unknown>,
): CaseIssue | null {
  const ref =
    typeof row.service_request_number === "string"
      ? row.service_request_number.trim()
      : "";
  const type = String(row.service_request_type ?? "").trim();
  const category = DALLAS_TYPES[type.toLowerCase()];
  if (!ref || !category) return null;
  const label = type.replace(/\s*-\s*CCS$/i, "");
  return {
    externalRef: `dallas:${ref}`,
    category,
    title: `City of Dallas code request — ${label}`,
    description: `Dallas 311 service request ${ref} for Code Compliance (${label}, status ${String(row.status ?? "open")}). Someone reported this address to the city; an inspector may visit. Found in the City of Dallas's public 311 records.`,
    issuedOn: day(row.created_date),
    deadline: day(row.overall_service_request_due_date),
    authority: "City of Dallas Code Compliance",
    authorityContact: `311 / (214) 670-5111 · SR ${ref}`,
  };
}

export function caseToIssue(
  city: CityId,
  row: Record<string, unknown>,
): CaseIssue | null {
  return city === "austin" ? austinCaseToIssue(row) : dallasCaseToIssue(row);
}
