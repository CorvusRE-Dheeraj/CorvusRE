// What Improvement Condition (Module 5) asks about, by improvement type. Pure
// data shared by the page, the summary and the AI extraction (which may only
// map to these sections/components). Site improvements — parking, drainage,
// fencing around the lot — live under Land Condition, not here.

export const IMPROVEMENT_TYPES = [
  "Daycare / Preschool",
  "School / Educational",
  "Retail / Shopping Center",
  "Office",
  "Self-Storage",
  "Warehouse / Industrial / Flex",
  "Restaurant",
  "Medical / Dental",
  "Multifamily / Hotel / Senior Living",
  "Mixed-Use / Other",
] as const;
export type ImprovementType = (typeof IMPROVEMENT_TYPES)[number];

export const CONDITIONS = ["Good", "Fair", "Poor", "Not Assessed", "Not Applicable"] as const;
export type ItemCondition = (typeof CONDITIONS)[number];

export type Section = { key: string; label: string; components: string[] };

// Every building, whatever its type.
export const GENERAL_SECTIONS: Section[] = [
  { key: "structure", label: "Structure & Foundation", components: ["Structure", "Foundation"] },
  {
    key: "roof_exterior",
    label: "Roof & Exterior",
    components: ["Roof", "Exterior walls", "Windows & doors", "Waterproofing"],
  },
  {
    key: "systems",
    label: "Building Systems",
    components: ["HVAC", "Electrical", "Plumbing", "Elevators", "Fire protection"],
  },
  {
    key: "interior",
    label: "Interior Condition",
    components: ["Flooring", "Ceilings", "Walls", "Restrooms", "Water damage", "Interior finishes"],
  },
  {
    key: "repairs",
    label: "Repairs & Functional Limitations",
    components: [
      "Deferred maintenance",
      "Required repairs",
      "Outdated layout",
      "Features limiting use",
    ],
  },
];

// Added for the building's type(s).
export const TYPE_FEATURES: Record<ImprovementType, string[]> = {
  "Daycare / Preschool": [
    "Classrooms",
    "Child-size restrooms",
    "Kitchen",
    "Activity areas",
    "Playground equipment & surfacing",
    "Playground fencing",
    "Controlled entry",
    "Drop-off area",
  ],
  "School / Educational": [
    "Classrooms",
    "Laboratories",
    "Library",
    "Cafeteria",
    "Gymnasium",
    "Assembly areas",
    "Playgrounds",
    "Sports facilities",
  ],
  "Retail / Shopping Center": [
    "Tenant suites",
    "Storefronts & glazing",
    "Interior build-outs",
    "Signage structures",
    "Canopies",
    "Loading areas",
    "Shared facilities",
  ],
  Office: [
    "Office layout",
    "Meeting rooms",
    "Reception",
    "Common areas",
    "Elevators",
    "Restrooms",
    "Building-system arrangement",
  ],
  "Self-Storage": [
    "Unit count & size mix",
    "Climate-controlled areas",
    "Roll-up doors",
    "Corridors",
    "Gates",
    "Security systems",
    "Drive-up access",
  ],
  "Warehouse / Industrial / Flex": [
    "Warehouse area",
    "Office area",
    "Clear height",
    "Loading docks",
    "Overhead doors",
    "Floor slab",
    "Ventilation",
    "Electrical infrastructure",
    "Operational limitations",
  ],
  Restaurant: [
    "Dining areas",
    "Kitchen infrastructure",
    "Exhaust system",
    "Grease management",
    "Cold storage",
    "Patio",
    "Drive-through",
  ],
  "Medical / Dental": [
    "Treatment rooms",
    "Specialized plumbing",
    "Specialized ventilation",
    "Accessibility features",
    "Fixed clinical infrastructure",
  ],
  "Multifamily / Hotel / Senior Living": [
    "Units / rooms",
    "Bathrooms",
    "Kitchens",
    "Corridors",
    "Balconies",
    "Elevators",
    "Laundry",
    "Common amenities",
  ],
  "Mixed-Use / Other": [],
};

/** The sections a building shows: the general ones plus its type features. */
export function sectionsFor(types: string[], customFeatures: string[] = []): Section[] {
  const features: string[] = [];
  for (const t of types) {
    for (const f of TYPE_FEATURES[t as ImprovementType] ?? []) {
      if (!features.includes(f)) features.push(f);
    }
  }
  for (const f of customFeatures)
    if (f.trim() && !features.includes(f.trim())) features.push(f.trim());
  return features.length > 0
    ? [
        ...GENERAL_SECTIONS,
        { key: "features", label: "Property-Specific Features", components: features },
      ]
    : GENERAL_SECTIONS;
}

// The four AI photo cards (Roof / HVAC / Exterior / Interior) each roll up
// these components — an owner-confirmed condition for any of them informs
// the card (see improvementRecords in the module input).
export const CARD_COMPONENTS: Record<"Roof" | "HVAC" | "Exterior" | "Interior", string[]> = {
  Roof: ["Roof"],
  HVAC: ["HVAC"],
  Exterior: ["Exterior walls", "Windows & doors", "Waterproofing", "Structure", "Foundation"],
  Interior: ["Flooring", "Ceilings", "Walls", "Restrooms", "Water damage", "Interior finishes"],
};

export const BUILDING_DETAIL_FIELDS = [
  { key: "buildingAreaSqft", label: "Building area (SF)", type: "number" },
  { key: "floors", label: "Number of floors", type: "number" },
  { key: "constructionType", label: "Construction type", type: "text" },
  { key: "yearBuilt", label: "Year built", type: "number" },
  { key: "renovations", label: "Renovations (what, when)", type: "text" },
  { key: "replacements", label: "Major component replacements", type: "text" },
] as const;
const WORD_NUMBERS: Record<string, number> = {
  single: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

/** A report's wording for a building fact, as the field stores it ("6,200" → 6200, "single story" → 1). */
export function detailValue(key: string, raw: string): string | number {
  const field = BUILDING_DETAIL_FIELDS.find((f) => f.key === key);
  if (field?.type !== "number") return raw.trim();
  const digits = raw.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (digits) return Number(digits[0]);
  const word = raw.toLowerCase().match(/\b(single|one|two|three|four|five)\b/);
  return word ? WORD_NUMBERS[word[1]] : raw.trim();
}

export type BuildingDetails = Partial<
  Record<(typeof BUILDING_DETAIL_FIELDS)[number]["key"], string | number | null>
>;

// What to photograph when a category has no evidence — only from safely
// accessible places; never climb onto a roof or open electrical / mechanical
// equipment.
export const MEDIA_REQUESTS: Record<string, string> = {
  structure:
    "Wall cracks, visible settlement or sloping floors — a wide shot of the wall plus a close-up of the crack.",
  roof_exterior:
    "Visible roof damage or missing material seen from the ground, ponding, or interior ceiling stains below a reported leak; damaged siding, windows and doors.",
  systems:
    "HVAC units with visible corrosion or damage and their equipment labels (from the ground or an accessible pad — don't open panels).",
  interior: "Damaged flooring, ceiling or water stains, visible leaks and restroom condition.",
  repairs:
    "The deferred-maintenance items or outdated features, plus any repair estimate you have.",
  features:
    "The property-specific features with issues — playground damage, storage-unit doors, loading docks, restaurant infrastructure.",
};

export const SAFETY_NOTE =
  "Only take photos or video from places you can reach safely — don't go onto the roof or open electrical or mechanical equipment.";
