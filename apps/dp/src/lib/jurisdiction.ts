// Jurisdiction & governing-authority analysis (PRD 1.1.5.C / 2.1.4).
//
// A deterministic, reference table of US jurisdictions CorvusDP has coverage
// notes for, plus a generic fallback so any city/county still produces a usable
// (clearly-flagged-as-estimated) result. This runs entirely client-side — no
// live GIS/zoning integration on the static build — so every consumer surface
// labels the output as an estimate pending staff validation.

export type JurisdictionLevel = "city" | "county" | "etj";

export type Department = {
  name: string;
  scope: string;
  website?: string;
};

export type JurisdictionInfo = {
  key: string;
  authority: string;
  level: JurisdictionLevel;
  county: string;
  state: string;
  portalUrl?: string;
  /** typical calendar weeks for a first plan-review cycle */
  firstReviewWeeks: [number, number];
  /** permits this jurisdiction commonly lets run in parallel */
  parallelizable: string[];
  departments: Department[];
  notes: string[];
  /** true when the reference table had a real entry (vs. the generic fallback) */
  matched: boolean;
};

type Seed = Omit<JurisdictionInfo, "key" | "matched">;

const GENERIC_DEPARTMENTS: Department[] = [
  {
    name: "Building / Development Services",
    scope: "Building permit, site development, plan review",
  },
  { name: "Planning & Zoning", scope: "Zoning verification, variances, platting, entitlements" },
  { name: "Engineering / Public Works", scope: "Civil, grading, drainage, right-of-way" },
  { name: "Fire Marshal", scope: "Fire protection review, life-safety" },
  { name: "Utilities", scope: "Water / wastewater availability & connection" },
];

const TABLE: Record<string, Seed> = {
  "austin,tx": {
    authority: "City of Austin",
    level: "city",
    county: "Travis",
    state: "TX",
    portalUrl: "https://abc.austintexas.gov/web/permit/public-search-other",
    firstReviewWeeks: [4, 8],
    parallelizable: ["Site Plan", "Subdivision / Plat"],
    departments: [
      {
        name: "Development Services Department",
        scope: "Building & site plan review",
        website: "https://www.austintexas.gov/department/development-services",
      },
      { name: "Planning Department", scope: "Zoning & entitlements" },
      { name: "Austin Water", scope: "Water/wastewater service extension" },
      { name: "Austin Fire Department", scope: "Fire & life-safety review" },
    ],
    notes: [
      "Austin uses a consolidated Site Plan review; civil and landscape are reviewed within it.",
      "Watershed & environmental review can add cycles for sites near creeks or the Edwards Aquifer.",
    ],
  },
  "dallas,tx": {
    authority: "City of Dallas",
    level: "city",
    county: "Dallas",
    state: "TX",
    portalUrl: "https://developdallas.dallascityhall.com/",
    firstReviewWeeks: [3, 6],
    parallelizable: ["Paving & Drainage", "Building Permit"],
    departments: [
      { name: "Development Services", scope: "Building permits & plan review" },
      { name: "Engineering (Public Works)", scope: "Paving, drainage, ROW" },
      { name: "Dallas Water Utilities", scope: "Water & wastewater" },
      { name: "Dallas Fire-Rescue", scope: "Fire review" },
    ],
    notes: [
      "Dallas allows building permit intake concurrent with paving & drainage for many project types.",
    ],
  },
  "houston,tx": {
    authority: "City of Houston",
    level: "city",
    county: "Harris",
    state: "TX",
    portalUrl: "https://www.pdinet.pd.houstontx.gov/cohilms/webs/",
    firstReviewWeeks: [2, 5],
    parallelizable: ["Building Permit", "Site / Infrastructure"],
    departments: [
      { name: "Houston Permitting Center", scope: "Building & site permits" },
      { name: "Public Works – Engineering", scope: "Infrastructure & drainage" },
      { name: "Houston Fire Department", scope: "Fire review" },
    ],
    notes: [
      "Houston has no zoning; use is governed by deed restrictions and Chapter 42 development ordinances.",
    ],
  },
  "fort worth,tx": {
    authority: "City of Fort Worth",
    level: "city",
    county: "Tarrant",
    state: "TX",
    portalUrl: "https://aca-prod.accela.com/CFW/",
    firstReviewWeeks: [3, 6],
    parallelizable: ["Infrastructure Plan Review", "Plat"],
    departments: [
      { name: "Development Services", scope: "Building & site plan" },
      { name: "Transportation & Public Works", scope: "Infrastructure, grading, drainage" },
      { name: "Water Department", scope: "Water/sewer availability" },
    ],
    notes: [],
  },
  "san antonio,tx": {
    authority: "City of San Antonio",
    level: "city",
    county: "Bexar",
    state: "TX",
    portalUrl: "https://aca-prod.accela.com/COSA/",
    firstReviewWeeks: [3, 7],
    parallelizable: ["Site Plan", "Tree / Land Clearing"],
    departments: [
      { name: "Development Services Department", scope: "Building, site, land development" },
      { name: "SAWS", scope: "Water & sewer (San Antonio Water System)" },
      { name: "SAFD", scope: "Fire review" },
    ],
    notes: ["Tree preservation review is a common critical-path item for undeveloped tracts."],
  },
  "celina,tx": {
    authority: "City of Celina",
    level: "city",
    county: "Collin",
    state: "TX",
    portalUrl: "https://www.celina-tx.gov/162/Development-Services",
    firstReviewWeeks: [3, 5],
    parallelizable: ["Civil / Site", "Plat"],
    departments: [
      { name: "Development Services", scope: "Building & site" },
      { name: "Engineering", scope: "Civil, grading, drainage" },
      { name: "Public Works / Utilities", scope: "Water & wastewater" },
    ],
    notes: [
      "Rapid-growth North Collin County jurisdiction; expect impact-fee updates each fiscal year.",
    ],
  },
  "frisco,tx": {
    authority: "City of Frisco",
    level: "city",
    county: "Collin",
    state: "TX",
    portalUrl: "https://www.friscotexas.gov/162/Development-Services",
    firstReviewWeeks: [3, 6],
    parallelizable: ["Civil / Site", "Building Permit"],
    departments: [
      { name: "Development Services", scope: "Building & site plan" },
      { name: "Engineering Services", scope: "Civil / drainage / grading" },
      { name: "Fire Prevention", scope: "Fire review" },
    ],
    notes: [],
  },
  "mckinney,tx": {
    authority: "City of McKinney",
    level: "city",
    county: "Collin",
    state: "TX",
    portalUrl: "https://www.mckinneytexas.org/163/Development-Services",
    firstReviewWeeks: [3, 6],
    parallelizable: ["Civil / Engineering", "Plat"],
    departments: [
      { name: "Development Services", scope: "Building & site" },
      { name: "Engineering", scope: "Civil / drainage" },
    ],
    notes: [],
  },
  "fate,tx": {
    authority: "City of Fate",
    level: "city",
    county: "Kaufman",
    state: "TX",
    portalUrl: "https://www.cityoffate.com/",
    firstReviewWeeks: [3, 5],
    parallelizable: ["Site", "Civil"],
    departments: [
      { name: "Development Services", scope: "Building & site" },
      { name: "Engineering", scope: "Civil / drainage" },
    ],
    notes: ["Site and Civil are commonly submitted simultaneously in Fate."],
  },
};

function normalize(s: string | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function analyzeJurisdiction(input: {
  city?: string;
  county?: string;
  state?: string;
  isEtj?: boolean;
}): JurisdictionInfo {
  const city = normalize(input.city);
  const state = normalize(input.state) || "tx";
  const key = `${city},${state}`;
  const seed = TABLE[key];

  if (seed) {
    return {
      key,
      matched: true,
      ...seed,
      level: input.isEtj ? "etj" : seed.level,
      notes: input.isEtj
        ? [
            "Property appears to be in the city's ETJ — the county governs building permits while the city retains platting/subdivision authority.",
            ...seed.notes,
          ]
        : seed.notes,
    };
  }

  const county = input.county ? `${input.county} County` : "the county";
  const authority = input.isEtj
    ? `${county} (ETJ of ${input.city ?? "the nearest city"})`
    : input.city
      ? `City of ${input.city}`
      : county;

  return {
    key,
    matched: false,
    authority,
    level: input.isEtj ? "etj" : input.city ? "city" : "county",
    county: input.county ?? "Unknown",
    state: (input.state ?? "TX").toUpperCase(),
    firstReviewWeeks: [4, 10],
    parallelizable: [],
    departments: GENERIC_DEPARTMENTS,
    notes: [
      "This jurisdiction is not yet in CorvusDP's verified coverage table — the analysis below is an estimate based on typical US municipal permitting practice and will be confirmed by a CorvusDP specialist.",
    ],
  };
}
