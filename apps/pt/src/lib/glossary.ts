// Plain-English meanings for the Texas property-tax words used across the app.
export const GLOSSARY: [string, string][] = [
  ["CAD", "Central Appraisal District — the county office that sets your property's value."],
  ["ARB", "Appraisal Review Board — the panel that hears your protest if you can't settle first."],
  ["Protest", "Your formal challenge that the appraised value is too high."],
  [
    "Informal review",
    "A first conversation with the county's appraiser to try to settle the value.",
  ],
  [
    "Formal hearing",
    "Your case in front of the ARB, with evidence, if the informal review doesn't settle it.",
  ],
  [
    "Binding arbitration",
    "An alternative after the ARB, where a neutral arbitrator sets the value.",
  ],
  ["Court appeal", "Taking the ARB's decision to district court instead."],
  [
    "BPP",
    "Business Personal Property — equipment and inventory a business owns, taxed separately.",
  ],
  ["Rendition", "The report you file listing your business personal property and its value."],
];

export const GLOSSARY_MAP = Object.fromEntries(GLOSSARY) as Record<string, string>;
