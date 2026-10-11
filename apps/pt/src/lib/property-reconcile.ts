import type { AttomProperty, RegridParcel } from "./property-sources";
import type { OfficialTaxRates } from "./tax-rates-official";

// The "verify & reconcile" step of the base-data pipeline: every source's answer
// for each key fact, one chosen value per fact, and a plain note wherever sources
// genuinely disagree. Deterministic — the same inputs always reconcile the same
// way, so the AI modules downstream read a stable record rather than re-judging
// sources each time.
//
// Which source wins, per fact:
//  - Assessed values, owner, account: the county appraisal district. It's the
//    official record a protest is argued against.
//  - Building facts: county first, then ATTOM.
//  - Parcel, lot, zoning, land use: Regrid (parcel GIS) first.
//  - Sales, annual tax bill: ATTOM.
// Values are only compared across sources reporting the SAME tax year — a new
// year's value isn't a disagreement. Regrid doesn't say which year its values are
// from, so its values are shown but never flagged.

export type SourceName = "County appraisal district" | "ATTOM" | "Regrid" | "Texas Comptroller";

export type CadFacts = {
  ownerName: string | null;
  accountNumber: string | null;
  propertyType: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  taxYear: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  lotSizeAcres: number | null;
  lotSizeSqft: number | null;
  deeds: { date: string | null }[];
};

export type FactUnit = "usd" | "sqft" | "acres" | "year" | "text" | "date";

export type ReconciledFact = {
  key: string;
  label: string;
  unit: FactUnit;
  value: string | number | null;
  source: SourceName | null;
  values: { source: SourceName; value: string | number }[];
  conflict: boolean;
};

export type Reconciliation = {
  facts: ReconciledFact[];
  conflicts: string[];
  // Actual effective rate (ATTOM's billed tax / assessed value) when known;
  // otherwise only the Comptroller's county + city portion.
  taxRate:
    | { kind: "actual"; rate: number; taxYear: number | null }
    | { kind: "partial"; rate: number; year: number; note: string }
    | null;
};

type Candidate = { source: SourceName; value: string | number | null | undefined };

const ACRE_SQFT = 43_560;

function acres(a: number | null | undefined, sqft: number | null | undefined): number | null {
  if (a != null) return a;
  if (sqft != null) return sqft / ACRE_SQFT;
  return null;
}

function present(c: Candidate[]): { source: SourceName; value: string | number }[] {
  return c.filter(
    (x): x is { source: SourceName; value: string | number } => x.value != null && x.value !== "",
  );
}

function normName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(THE|OF|AND|ETAL|ET AL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function numericConflict(values: number[], tolerance: number): boolean {
  if (values.length < 2) return false;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max > 0 && (max - min) / max > tolerance;
}

function fact(
  key: string,
  label: string,
  unit: FactUnit,
  candidates: Candidate[],
  conflictOf: (vals: { source: SourceName; value: string | number }[]) => boolean = () => false,
): ReconciledFact {
  const values = present(candidates);
  return {
    key,
    label,
    unit,
    value: values[0]?.value ?? null,
    source: values[0]?.source ?? null,
    values,
    conflict: conflictOf(values),
  };
}

export function reconcileProperty(input: {
  cad: CadFacts | null;
  attom: AttomProperty | null;
  regrid: RegridParcel | null;
  officialRates: OfficialTaxRates | null;
}): Reconciliation {
  const { cad, attom, regrid, officialRates } = input;
  const CAD: SourceName = "County appraisal district";
  // Assessed values are only comparable when ATTOM reports the same tax year.
  const attomSameYear =
    !!attom &&
    !!cad &&
    attom.taxYear != null &&
    cad.taxYear != null &&
    attom.taxYear === cad.taxYear;

  const valueFact = (
    key: string,
    label: string,
    c: number | null | undefined,
    a: number | null | undefined,
    r: number | null | undefined,
  ) =>
    fact(
      key,
      label,
      "usd",
      [
        { source: CAD, value: c },
        { source: "ATTOM", value: a },
        { source: "Regrid", value: r },
      ],
      (vals) =>
        attomSameYear &&
        numericConflict(
          vals.filter((v) => v.source !== "Regrid").map((v) => Number(v.value)),
          0.02,
        ),
    );

  const facts: ReconciledFact[] = [
    fact(
      "owner",
      "Owner of record",
      "text",
      [
        { source: CAD, value: cad?.ownerName },
        { source: "ATTOM", value: attom?.ownerName },
        { source: "Regrid", value: regrid?.ownerName },
      ],
      (vals) => {
        const names = vals.map((v) => normName(String(v.value))).filter(Boolean);
        // Different name formats ("SMITH JOHN" vs "JOHN SMITH") share words — only
        // flag owners with no words in common.
        return names.some((a) =>
          names.some(
            (b) => a !== b && !a.split(" ").some((w) => w.length > 2 && b.split(" ").includes(w)),
          ),
        );
      },
    ),
    fact(
      "parcel",
      "Account / parcel number",
      "text",
      [
        { source: CAD, value: cad?.accountNumber },
        { source: "Regrid", value: regrid?.parcelNumber },
        { source: "ATTOM", value: attom?.apn },
      ],
      (vals) => {
        // Formats differ (dashes, prefixes, zero-padding) — only flag numbers
        // with no overlap at all.
        const ds = vals.map((v) => digits(String(v.value))).filter((d) => d.length >= 6);
        return ds.some((a) => ds.some((b) => !a.includes(b) && !b.includes(a)));
      },
    ),
    fact("taxYear", "Tax year of assessed values", "year", [
      { source: CAD, value: cad?.taxYear },
      { source: "ATTOM", value: attom?.taxYear },
    ]),
    valueFact(
      "totalValue",
      "Assessed total value",
      cad?.totalValue,
      attom?.assessedTotal,
      regrid?.totalValue,
    ),
    valueFact(
      "landValue",
      "Assessed land value",
      cad?.landValue,
      attom?.assessedLand,
      regrid?.landValue,
    ),
    valueFact(
      "improvementValue",
      "Assessed improvement value",
      cad?.improvementValue,
      attom?.assessedImprovement,
      regrid?.improvementValue,
    ),
    fact(
      "buildingSqft",
      "Building area",
      "sqft",
      [
        { source: CAD, value: cad?.buildingSqft },
        { source: "ATTOM", value: attom?.buildingSqft },
      ],
      (vals) =>
        numericConflict(
          vals.map((v) => Number(v.value)),
          0.05,
        ),
    ),
    fact(
      "yearBuilt",
      "Year built",
      "year",
      [
        { source: CAD, value: cad?.yearBuilt },
        { source: "ATTOM", value: attom?.yearBuilt },
      ],
      (vals) => new Set(vals.map((v) => Number(v.value))).size > 1,
    ),
    fact(
      "lotAcres",
      "Lot size",
      "acres",
      [
        { source: "Regrid", value: acres(regrid?.lotSizeAcres, regrid?.lotSizeSqft) },
        { source: CAD, value: acres(cad?.lotSizeAcres, cad?.lotSizeSqft) },
        { source: "ATTOM", value: acres(attom?.lotSizeAcres, attom?.lotSizeSqft) },
      ],
      (vals) =>
        numericConflict(
          vals.map((v) => Number(v.value)),
          0.05,
        ),
    ),
    fact("landUse", "Land use / property type", "text", [
      { source: "Regrid", value: regrid?.landUse },
      { source: "ATTOM", value: attom?.propertyType },
      { source: CAD, value: cad?.propertyType },
    ]),
    fact("zoning", "Zoning", "text", [
      {
        source: "Regrid",
        value: regrid?.zoning
          ? `${regrid.zoning}${regrid.zoningDescription ? ` — ${regrid.zoningDescription}` : ""}`
          : null,
      },
    ]),
    fact("lastSaleDate", "Last sale / transfer date", "date", [
      { source: "ATTOM", value: attom?.lastSaleDate },
      { source: "Regrid", value: regrid?.lastSaleDate },
      { source: CAD, value: cad?.deeds.find((d) => d.date)?.date ?? null },
    ]),
    fact("lastSaleAmount", "Last sale price", "usd", [
      { source: "ATTOM", value: attom?.lastSaleAmount },
      { source: "Regrid", value: regrid?.lastSaleAmount },
    ]),
    fact("annualTax", "Annual property tax", "usd", [{ source: "ATTOM", value: attom?.taxAmount }]),
  ];

  const conflicts = facts
    .filter((f) => f.conflict)
    .map(
      (f) =>
        `${f.label}: ${f.values.map((v) => `${v.source} says ${formatFactValue(f.unit, v.value)}`).join("; ")}`,
    );

  let taxRate: Reconciliation["taxRate"] = null;
  if (attom?.taxAmount != null && attom.assessedTotal != null && attom.assessedTotal > 0) {
    taxRate = {
      kind: "actual",
      rate: attom.taxAmount / attom.assessedTotal,
      taxYear: attom.taxYear,
    };
  } else if (officialRates) {
    taxRate = {
      kind: "partial",
      rate: officialRates.knownRate,
      year: officialRates.year,
      note: officialRates.city
        ? "County + city rates only — school district and any special districts are not included."
        : "County rate only — city, school district and any special districts are not included.",
    };
  }

  return { facts, conflicts, taxRate };
}

export function formatFactValue(unit: FactUnit, value: string | number | null): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  switch (unit) {
    case "usd":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "sqft":
      return `${Math.round(value).toLocaleString("en-US")} SF`;
    case "acres":
      return `${value.toFixed(3).replace(/\.?0+$/, "")} acres`;
    default:
      return String(value);
  }
}
