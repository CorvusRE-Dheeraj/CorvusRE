import { supabase } from "./supabase";
import { cadLookup, cadLookupByAccount, type CadRecord } from "./cad-lookup";
import { getCadRecordUrl } from "./cad-record-url";
import { getSiteGis, type SiteGisResult } from "./site-gis";
import { uploadDocument, type DocumentRecord } from "./documents";
import { setDocumentModules } from "./document-modules";
import { buildTextPdf } from "./pdf-text";
import type { PropertyRecord } from "./properties";
import {
  fetchPropertySources,
  type AttomComp,
  type AttomProperty,
  type PropertySourcesResult,
  type RegridParcel,
} from "./property-sources";
import { lookupOfficialTaxRates, type OfficialTaxRates } from "./tax-rates-official";
import { formatFactValue, reconcileProperty, type Reconciliation } from "./property-reconcile";

// The property's AI-fetched "base data" — one synthesized record per
// property. The pipeline: Address → Geocode (caller's coords) → Regrid parcel →
// CAD/county → ATTOM → other sources (FEMA/USGS, Texas Comptroller rates, the
// county record page) → reconcile (property-reconcile.ts) → this central
// document → every module. Stored as a PDF in the central Documents
// repository, tagged "AI Fetched — Property Base Data" and to every module,
// so it's the single foundation every module reads instead of the user
// re-entering the same facts. See supabase/functions/
// refresh-property-base-data for the weekly re-check + change notification.

export const BASE_DATA_DOCUMENT_TYPE = "AI Fetched — Property Base Data";

// Every AI Report module + case section that benefits from the CAD/site
// facts (mirrors MODULE_CATALOG ids in document-modules.ts).
const BASE_DATA_MODULE_IDS = [
  "health",
  "strategy",
  "comps",
  "site",
  "zoning",
  "income",
  "evidence",
  "executive",
];

export type PropertyBaseSnapshot = {
  fetchedAt: string;
  // A trimmed copy of the live CAD record — only the fields the base-data
  // document renders and the diff checks.
  cad: {
    ownerName: string | null;
    accountNumber: string | null;
    propertyType: string | null;
    landValue: number | null;
    improvementValue: number | null;
    totalValue: number | null;
    taxYear: number | null;
    legalDescription: string | null;
    subdivision: string | null;
    // Structure / lot detail — only present for the counties whose parcel layer
    // publishes it (see CadRecord in cad-lookup.ts). Null otherwise.
    buildingSqft: number | null;
    yearBuilt: number | null;
    buildingClass: string | null;
    lotSizeSqft: number | null;
    lotSizeAcres: number | null;
    valueHistory: { year: number; total: number | null }[];
    deeds: { date: string | null; type: string | null; instrumentNum: string | null }[];
  } | null;
  siteGis: SiteGisResult | null;
  recordUrl: string | null;
  // The paid sources and the Comptroller's official rates — optional because
  // snapshots stored before they existed don't have them. Reconciliation isn't
  // stored: it's recomputed from these + `cad` (see reconcileSnapshot), so the
  // weekly county refresh, which only replaces `cad`, is always reflected.
  attom?: AttomProperty | null;
  regrid?: RegridParcel | null;
  attomComps?: AttomComp[];
  sourceStatus?: PropertySourcesResult["status"];
  officialRates?: OfficialTaxRates | null;
  // Which lookups actually returned something.
  sources: string[];
};

export type PropertyBaseData = {
  snapshot: PropertyBaseSnapshot;
  documentId: string | null;
  fetchedAt: string;
  lastCheckedAt: string;
  lastChangeNote: string | null;
};

type Row = {
  property_id: string;
  snapshot: PropertyBaseSnapshot;
  document_id: string | null;
  fetched_at: string;
  last_checked_at: string;
  last_change_note: string | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "not stated" : `$${Math.round(n).toLocaleString()}`;

function trimCad(record: CadRecord | null): PropertyBaseSnapshot["cad"] {
  if (!record) return null;
  return {
    ownerName: record.ownerName,
    accountNumber: record.accountNumber,
    propertyType: record.propertyType,
    landValue: record.landValue,
    improvementValue: record.improvementValue,
    totalValue: record.totalValue,
    taxYear: record.taxYear,
    legalDescription: record.legalDescription ?? null,
    subdivision: record.subdivision ?? null,
    buildingSqft: record.buildingSqft ?? null,
    yearBuilt: record.yearBuilt ?? null,
    buildingClass: record.buildingClass ?? null,
    lotSizeSqft: record.lotSizeSqft ?? null,
    lotSizeAcres: record.lotSizeAcres ?? null,
    valueHistory: (record.valueHistory ?? [])
      .map((h) => ({ year: h.year, total: h.appraisedValue ?? h.marketValue ?? null }))
      .sort((a, b) => a.year - b.year),
    deeds: (record.deeds ?? [])
      .slice(0, 8)
      .map((d) => ({ date: d.date, type: d.type, instrumentNum: d.instrumentNum })),
  };
}

// Address-driven fetch of everything the app can publicly source. Never
// throws — a partial snapshot (or an all-null one) is a valid result; the
// caller records which sources answered.
export async function fetchPropertyBaseSnapshot(
  property: Pick<PropertyRecord, "address" | "cad" | "accountNumber">,
  coords: { lat: number; lng: number } | null,
): Promise<PropertyBaseSnapshot> {
  const sources: string[] = [];

  // ATTOM + Regrid run alongside the county lookup — they only need the address
  // and the geocoded point.
  const paid = property.address ? fetchPropertySources(property.address, coords) : null;

  let record: CadRecord | null = null;
  if (property.cad && property.accountNumber) {
    record = await cadLookupByAccount(property.cad, property.accountNumber).catch(() => null);
  }
  if (!record && property.address) {
    const res = await cadLookup(property.address).catch(() => null);
    if (res && res.matched === true) record = res.record;
  }
  if (record) sources.push("county appraisal district");

  const sourcesResult = paid ? await paid : null;
  if (sourcesResult?.regrid) sources.push("Regrid parcel data");
  if (sourcesResult?.attom) sources.push("ATTOM property data");
  if (sourcesResult?.attomComps?.length) sources.push("ATTOM comparable sales");

  const officialRates = await lookupOfficialTaxRates(record?.cad ?? property.cad, property.address);
  if (officialRates) sources.push("Texas Comptroller tax rates");

  let siteGis: SiteGisResult | null = null;
  if (coords) {
    siteGis = await getSiteGis(coords).catch(() => null);
    if (siteGis && (siteGis.floodZone || siteGis.elevationFt != null)) {
      sources.push("FEMA + USGS");
    } else {
      siteGis =
        siteGis && (siteGis.nearestHighwayMi != null || siteGis.nearestRailMi != null)
          ? siteGis
          : null;
    }
  }

  const recordUrl = record
    ? getCadRecordUrl({
        cad: record.cad,
        accountNumber: record.accountNumber,
        bisPropertyId: record.bisPropertyId,
      })
    : property.cad
      ? getCadRecordUrl({ cad: property.cad, accountNumber: property.accountNumber })
      : null;
  if (recordUrl) sources.push("county record page");

  return {
    fetchedAt: new Date().toISOString(),
    cad: trimCad(record),
    siteGis,
    recordUrl,
    attom: sourcesResult?.attom ?? null,
    regrid: sourcesResult?.regrid ?? null,
    attomComps: sourcesResult?.attomComps ?? [],
    sourceStatus: sourcesResult?.status,
    officialRates,
    sources,
  };
}

// The cross-source record every module reads — recomputed, never stored.
export function reconcileSnapshot(snapshot: PropertyBaseSnapshot): Reconciliation {
  return reconcileProperty({
    cad: snapshot.cad,
    attom: snapshot.attom ?? null,
    regrid: snapshot.regrid ?? null,
    officialRates: snapshot.officialRates ?? null,
  });
}

const STATUS_LABEL: Record<string, string> = {
  ok: "matched",
  no_match: "no match for this address",
  not_configured: "not connected yet",
  error: "unavailable right now",
};

// "123 Main St, Dallas — sold $3,100,000 on 2024-05-01 · 24,000 SF ($129.17/SF) · 0.8 mi"
export function compLine(c: AttomComp): string {
  return [
    `${c.address} — sold $${Math.round(c.saleAmount).toLocaleString("en-US")}${c.saleDate ? ` on ${c.saleDate}` : ""}`,
    c.buildingSqft != null
      ? `${Math.round(c.buildingSqft).toLocaleString("en-US")} SF${c.pricePerSqft != null ? ` ($${c.pricePerSqft.toFixed(2)}/SF)` : ""}`
      : null,
    c.yearBuilt != null ? `built ${c.yearBuilt}` : null,
    c.distanceMiles != null ? `${c.distanceMiles.toFixed(1)} mi` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

// The human-readable record rendered into the stored PDF.
export function buildBaseDataMarkdown(
  snapshot: PropertyBaseSnapshot,
  property: Pick<PropertyRecord, "address" | "cad">,
): string {
  const lines: string[] = [];
  lines.push(`# Property Base Data — ${property.address}`);
  lines.push("");
  lines.push(
    `AI-fetched from public county + federal sources on ` +
      `${new Date(snapshot.fetchedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}. ` +
      `This is a convenience summary — verify every figure against your official appraisal notice.`,
  );
  lines.push("");

  // The reconciled record first — it's what every module should rely on.
  const rec = reconcileSnapshot(snapshot);
  const known = rec.facts.filter((f) => f.value != null);
  lines.push("## Verified property facts (reconciled across sources)");
  if (known.length === 0) {
    lines.push("- No source returned property facts for this address yet.");
  } else {
    for (const f of known) {
      const others = f.values
        .slice(1)
        .filter((v) => formatFactValue(f.unit, v.value) !== formatFactValue(f.unit, f.value));
      lines.push(
        `- ${f.label}: ${formatFactValue(f.unit, f.value)} (${f.source})` +
          (others.length
            ? ` — also reported: ${others.map((v) => `${formatFactValue(f.unit, v.value)} (${v.source})`).join(", ")}`
            : "") +
          // Plain text: the PDF's standard Helvetica can't encode symbols like ⚠.
          (f.conflict ? " [sources disagree]" : ""),
      );
    }
  }
  if (rec.conflicts.length > 0) {
    lines.push("");
    lines.push("### Where sources disagree — verify against your appraisal notice");
    for (const c of rec.conflicts) lines.push(`- ${c}`);
  }
  if (rec.taxRate) {
    lines.push("");
    lines.push(
      rec.taxRate.kind === "actual"
        ? `- Effective tax rate (ATTOM billed tax ÷ assessed value${rec.taxRate.taxYear ? `, ${rec.taxRate.taxYear}` : ""}): ${pct(rec.taxRate.rate)}`
        : `- Known tax rate (Texas Comptroller ${rec.taxRate.year}): at least ${pct(rec.taxRate.rate)} — ${rec.taxRate.note}`,
    );
  }
  lines.push("");

  const c = snapshot.cad;
  lines.push("## County Appraisal District record");
  if (!c) {
    lines.push(
      `- No live data source for ${property.cad ?? "this county"} — this app can only pull ` +
        `structured records for a handful of Texas counties. Use the county record page link below, ` +
        `or upload your appraisal notice so AI can read it.`,
    );
  } else {
    if (c.ownerName) lines.push(`- Owner of record: ${c.ownerName}`);
    if (c.accountNumber) lines.push(`- Account / parcel number: ${c.accountNumber}`);
    if (c.propertyType) lines.push(`- Property classification: ${c.propertyType}`);
    if (c.legalDescription) lines.push(`- Legal description: ${c.legalDescription}`);
    if (c.subdivision) lines.push(`- Subdivision: ${c.subdivision}`);
    if (c.buildingSqft != null)
      lines.push(`- Building area (per CAD): ${Math.round(c.buildingSqft).toLocaleString()} SF`);
    if (c.yearBuilt != null) lines.push(`- Year built (per CAD): ${c.yearBuilt}`);
    if (c.buildingClass) lines.push(`- Construction class (per CAD): ${c.buildingClass}`);
    if (c.lotSizeAcres != null || c.lotSizeSqft != null) {
      const parts = [
        c.lotSizeSqft != null ? `${Math.round(c.lotSizeSqft).toLocaleString()} SF` : null,
        c.lotSizeAcres != null ? `${c.lotSizeAcres.toFixed(3).replace(/\.?0+$/, "")} acres` : null,
      ].filter(Boolean);
      lines.push(`- Lot size (per CAD): ${parts.join(" / ")}`);
    }
    lines.push(
      `- Assessed values${c.taxYear ? ` (tax year ${c.taxYear})` : ""}: land ${money(c.landValue)}, ` +
        `improvement ${money(c.improvementValue)}, total ${money(c.totalValue)}`,
    );
    if (c.valueHistory.length > 0) {
      lines.push("");
      lines.push("### Assessed value history");
      for (const h of c.valueHistory) lines.push(`- ${h.year}: ${money(h.total)}`);
    }
    if (c.deeds.length > 0) {
      lines.push("");
      lines.push("### Recorded deeds / transfers");
      for (const d of c.deeds)
        lines.push(
          `- ${d.date ?? "date n/a"}${d.type ? ` — ${d.type}` : ""}${d.instrumentNum ? ` (instrument ${d.instrumentNum})` : ""}`,
        );
    }
  }

  lines.push("");
  lines.push("## Site data (FEMA + USGS)");
  const g = snapshot.siteGis;
  if (!g || (!g.floodZone && g.elevationFt == null)) {
    lines.push("- No point-level flood / elevation data available for this location.");
  } else {
    if (g.floodZone)
      lines.push(
        `- FEMA flood zone: ${g.floodZone.zone} — ${g.floodZone.label}` +
          `${g.floodZone.inSFHA ? " (Special Flood Hazard Area)" : ""}`,
      );
    if (g.elevationFt != null)
      lines.push(`- USGS ground elevation: ~${Math.round(g.elevationFt)} ft`);
    if (g.nearestHighwayMi != null)
      lines.push(`- Nearest major highway: ~${g.nearestHighwayMi.toFixed(1)} mi`);
    if (g.nearestRailMi != null)
      lines.push(`- Nearest rail line: ~${g.nearestRailMi.toFixed(1)} mi`);
  }

  lines.push("");
  lines.push("## County record page");
  lines.push(
    snapshot.recordUrl
      ? `- ${snapshot.recordUrl}`
      : "- No direct county record link available for this appraisal district.",
  );

  const r = snapshot.officialRates;
  if (r) {
    lines.push("");
    lines.push(`## Official tax rates (Texas Comptroller, ${r.year})`);
    lines.push(`- ${r.county.name} County: ${pct(r.county.rate)}`);
    if (r.city) lines.push(`- City of ${r.city.name}: ${pct(r.city.rate)}`);
    if (r.schoolDistricts)
      lines.push(
        `- School district: not identified from the address — the ${r.schoolDistricts.count} districts ` +
          `based in this county range ${pct(r.schoolDistricts.min)}–${pct(r.schoolDistricts.max)}`,
      );
    lines.push("- College, hospital, MUD and other special districts are not included.");
    lines.push(`- Source: ${r.sourceUrl}`);
  }

  const reg = snapshot.regrid;
  if (reg?.regridPath) {
    lines.push("");
    lines.push("## Parcel (Regrid)");
    lines.push(`- Parcel record: https://app.regrid.com${reg.regridPath}`);
    if (reg.geometry) lines.push("- Parcel boundary on file (used for site and zoning analysis).");
  }

  const comps = snapshot.attomComps ?? [];
  if (comps.length > 0) {
    lines.push("");
    lines.push("## Recent comparable sales (ATTOM)");
    for (const c of comps) lines.push(`- ${compLine(c)}`);
  }

  if (snapshot.sourceStatus) {
    lines.push("");
    lines.push("## Data sources checked");
    lines.push(
      `- ATTOM: ${STATUS_LABEL[snapshot.sourceStatus.attom] ?? snapshot.sourceStatus.attom}`,
    );
    lines.push(
      `- Regrid: ${STATUS_LABEL[snapshot.sourceStatus.regrid] ?? snapshot.sourceStatus.regrid}`,
    );
    if (snapshot.sourceStatus.attomComps)
      lines.push(
        `- ATTOM comparable sales: ${STATUS_LABEL[snapshot.sourceStatus.attomComps] ?? snapshot.sourceStatus.attomComps}`,
      );
  }

  return lines.join("\n");
}

// Renders the base data to a PDF, files it in the central repository tagged
// "AI Fetched" + to every module, replaces any prior base-data document,
// and upserts the property_base_data row. Returns whether the fetched
// snapshot materially differs from the one previously stored.
export async function savePropertyBaseData(
  userId: string,
  property: Pick<PropertyRecord, "id" | "address" | "cad">,
  snapshot: PropertyBaseSnapshot,
): Promise<{ documentId: string; changed: boolean; changeNote: string | null }> {
  const prior = await getPropertyBaseData(property.id);
  const changeNote = prior ? diffBaseSnapshots(prior.snapshot, snapshot) : null;

  const markdown = buildBaseDataMarkdown(snapshot, property);
  const bytes = await buildTextPdf(`Property Base Data — ${property.address}`, markdown);
  const file = new File([bytes as BlobPart], `property-base-data.pdf`, {
    type: "application/pdf",
  });
  const doc = await uploadDocument(userId, property.id, file, BASE_DATA_DOCUMENT_TYPE);
  await setDocumentModules(doc.id, BASE_DATA_MODULE_IDS).catch(() => {});

  const { error } = await supabase.from("property_base_data").upsert(
    {
      property_id: property.id,
      user_id: userId,
      snapshot,
      document_id: doc.id,
      sources: snapshot.sources,
      fetched_at: snapshot.fetchedAt,
      last_checked_at: new Date().toISOString(),
      last_change_note: changeNote,
    },
    { onConflict: "property_id" },
  );
  if (error) throw error;

  // Retire the previous base-data document so the repository holds exactly
  // one current copy (soft delete — it stays in "Recently deleted"). The
  // deleted_at column is in the owner update grant.
  if (prior?.documentId && prior.documentId !== doc.id) {
    await supabase
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", prior.documentId)
      .then(undefined, () => {});
  }

  return { documentId: doc.id, changed: !!changeNote, changeNote };
}

export async function getPropertyBaseData(propertyId: string): Promise<PropertyBaseData | null> {
  const { data, error } = await supabase
    .from("property_base_data")
    .select("property_id, snapshot, document_id, fetched_at, last_checked_at, last_change_note")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Row;
  return {
    snapshot: row.snapshot,
    documentId: row.document_id,
    fetchedAt: row.fetched_at,
    lastCheckedAt: row.last_checked_at,
    lastChangeNote: row.last_change_note,
  };
}

// Material-change detector — a one-line human note, or null when nothing
// that matters to a protest analysis moved.
export function diffBaseSnapshots(
  prev: PropertyBaseSnapshot,
  next: PropertyBaseSnapshot,
): string | null {
  const a = prev.cad;
  const b = next.cad;
  if (!a || !b) return null;
  const notes: string[] = [];
  const valChange = (label: string, x: number | null, y: number | null) => {
    if (x != null && y != null && Math.abs(x - y) > 1) {
      notes.push(`${label} ${money(x)} → ${money(y)}`);
    }
  };
  valChange("total assessed value", a.totalValue, b.totalValue);
  valChange("land value", a.landValue, b.landValue);
  valChange("improvement value", a.improvementValue, b.improvementValue);
  if (
    a.buildingSqft != null &&
    b.buildingSqft != null &&
    Math.abs(a.buildingSqft - b.buildingSqft) > 1
  ) {
    notes.push(
      `CAD building area ${Math.round(a.buildingSqft).toLocaleString()} → ${Math.round(
        b.buildingSqft,
      ).toLocaleString()} SF`,
    );
  }
  if (a.yearBuilt != null && b.yearBuilt != null && a.yearBuilt !== b.yearBuilt) {
    notes.push(`CAD year built ${a.yearBuilt} → ${b.yearBuilt}`);
  }
  if (a.taxYear != null && b.taxYear != null && a.taxYear !== b.taxYear) {
    notes.push(`tax year ${a.taxYear} → ${b.taxYear}`);
  }
  if (a.ownerName && b.ownerName && a.ownerName.trim() !== b.ownerName.trim()) {
    notes.push(`owner of record changed`);
  }
  if (
    (a.legalDescription ?? "").trim() !== (b.legalDescription ?? "").trim() &&
    a.legalDescription &&
    b.legalDescription
  ) {
    notes.push(`legal description changed`);
  }
  if (b.deeds.length > a.deeds.length) {
    notes.push(`${b.deeds.length - a.deeds.length} new recorded deed/transfer`);
  }
  const az = prev.siteGis?.floodZone?.zone ?? null;
  const bz = next.siteGis?.floodZone?.zone ?? null;
  if (az && bz && az !== bz) notes.push(`FEMA flood zone ${az} → ${bz}`);

  return notes.length > 0 ? notes.join("; ") : null;
}

export function isBaseDataDocument(doc: Pick<DocumentRecord, "documentType">): boolean {
  return doc.documentType === BASE_DATA_DOCUMENT_TYPE;
}
