// Pure logic for verify-property (no Deno APIs — unit-tested from
// apps/pt/src/lib/property-verification.test.ts).
//
// Three kinds of evidence, in order of how much they can be trusted:
//   1. county — every detail compared with the county (CAD) record. A made-up
//      or altered notice can look perfect but still won't match the county.
//   2. file   — what the file says about itself: the tool that produced it
//      (an AI generator, an image editor, a word processor) and whether it
//      was edited after it was first saved.
//   3. ai     — Corvus AI's read of the page (odd fonts in value fields,
//      missing official elements, totals that don't add up). A signal only:
//      no tool can prove from looks alone that a document is AI-made.
// Any flag means staff review; nothing flagged is approved on its own.

export type VerificationFlag = {
  code: string;
  source: "county" | "file" | "ai";
  severity: "high" | "medium";
  message: string;
};

export type VerificationStatus = "verified" | "needs_review" | "test";

/** What the county record says (cad-lookup's CadRecord, the parts compared). */
export type CadFacts = {
  ownerName: string | null;
  propertyAddress: string | null;
  accountNumber: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  valueYear?: number | null;
  taxYear?: number | null;
  upcomingValueYear?: number | null;
  valueHistory?: Array<{
    year: number;
    landValue: number | null;
    improvementValue: number | null;
    marketValue: number | null;
    appraisedValue?: number | null;
  }>;
};

/** The same details as claimed by a document or saved on a property. */
export type ClaimedFacts = {
  ownerName?: string | null;
  address?: string | null;
  accountNumber?: string | null;
  taxYear?: number | null;
  landValue?: number | null;
  improvementValue?: number | null;
  totalValue?: number | null;
  /** a notice can show both — matching either county figure is fine */
  appraisedValue?: number | null;
};

// Documents CorvusPT produces itself — nothing to authenticate.
export const GENERATED_DOCUMENT_TYPES = new Set([
  "AI Fetched — Property Base Data",
  "AI Property Summary",
  "CAD Hearing Evidence",
  "County Email",
  "Service Agreement",
  "Signed Notice of Protest",
  "Signed Appointment of Agent",
  "Signed Evidence Declaration",
  "Settlement Agreement — Signed",
]);

const AI_TOOLS =
  /chatgpt|openai|dall[\s·-]?e|midjourney|stable[\s-]?diffusion|firefly|imagen|gemini|ideogram|leonardo\.ai|flux\.1|grok|trainedalgorithmicmedia|compositewithtrainedalgorithmicmedia/i;
const EDITORS =
  /photoshop|illustrator|gimp|canva|pixelmator|affinity|inkscape|snapseed|picsart|pdfescape|sejda|smallpdf|ilovepdf|pdffiller|dochub|pdf[\s-]?expert|foxit phantompdf|nitro pro/i;
const WORD_PROCESSORS = /microsoft[®\s]*word|google docs|libreoffice|openoffice|pages\b|wps writer/i;

/** What the file says about itself — producer tools, AI labels, later edits. */
export function fileSignals(bytes: Uint8Array, mimeType: string): VerificationFlag[] {
  // latin1 keeps every byte as one character, so markers can be searched
  // without decoding the (often binary) file
  let text = "";
  const max = Math.min(bytes.length, 8_000_000);
  for (let i = 0; i < max; i += 65536) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, max)));
  }
  const flags: VerificationFlag[] = [];
  const tools: string[] = [];
  for (const re of [
    /\/(?:Producer|Creator)\s*\(([^)]{1,200})\)/g,
    /<(?:xmp:CreatorTool|pdf:Producer|photoshop:History|tiff:Software|exif:Software)>([^<]{1,200})</g,
  ]) {
    for (const m of text.matchAll(re)) tools.push(m[1].trim());
  }
  // EXIF "Software" in JPEG/PNG is a plain ASCII run; look for known names anywhere
  const haystack = tools.join(" | ") + " " + (mimeType.startsWith("image/") ? text : "");

  const ai = haystack.match(AI_TOOLS);
  if (ai || /c2pa|jumbf/i.test(text)) {
    flags.push({
      code: "file_ai_generated",
      source: "file",
      severity: "high",
      message: ai
        ? `The file says it was made with an AI tool (${ai[0]}).`
        : "The file carries AI/content-credential labels (C2PA).",
    });
  }
  const editor = haystack.match(EDITORS);
  if (editor) {
    flags.push({
      code: "file_edited_tool",
      source: "file",
      severity: "medium",
      message: `The file was saved by an editing tool (${editor[0]}) — county documents aren't.`,
    });
  }
  const word = tools.join(" | ").match(WORD_PROCESSORS);
  if (word) {
    flags.push({
      code: "file_word_processor",
      source: "file",
      severity: "medium",
      message: `The file was produced by a word processor (${word[0]}), not a county system.`,
    });
  }
  if (mimeType === "application/pdf") {
    const eofs = (text.match(/%%EOF/g) ?? []).length;
    const linearized = /\/Linearized\s/.test(text) ? 1 : 0;
    if (eofs - linearized > 1) {
      flags.push({
        code: "file_modified_after_creation",
        source: "file",
        severity: "medium",
        message: "The PDF was changed after it was first saved.",
      });
    }
  }
  return flags;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["and", "the", "of", "etal", "et", "al"].includes(w));

export function sameAccount(a: string, b: string): boolean {
  const x = norm(a).replace(/^0+/, "");
  const y = norm(b).replace(/^0+/, "");
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.endsWith(y) || y.endsWith(x)));
}

/** Owner names are written many ways ("SMITH JOHN & MARY" / "John Smith"). */
export function sameOwner(a: string, b: string): boolean {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return false;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size) >= 0.6;
}

const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

/**
 * Same street number and the same first street-name word ("1020 S GRIBBLE" =
 * "1020 Gribble" — a direction prefix is often dropped). An address with no
 * number ("PARKER RD, WYLIE") is compared by its street part.
 */
export function sameAddress(a: string, b: string): boolean {
  const parts = (v: string) => {
    const street = v.toLowerCase().split(",")[0];
    const tokens = street.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const num = /^\d+$/.test(tokens[0] ?? "") ? tokens.shift()! : null;
    while (tokens.length > 1 && DIRECTIONS.has(tokens[0])) tokens.shift();
    return { num, name: tokens[0] ?? null, street: tokens.join(" ") };
  };
  const x = parts(a);
  const y = parts(b);
  if (!x.name || !y.name) return false;
  if (x.num || y.num) return x.num === y.num && x.name === y.name;
  return x.street === y.street;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The county's values for one year: the current values or that year's history. */
function countyYear(cad: CadFacts, year: number | null | undefined) {
  const current = {
    landValue: cad.landValue,
    improvementValue: cad.improvementValue,
    totals: [cad.totalValue].filter((v): v is number => v != null),
  };
  const currentYear = cad.valueYear ?? cad.taxYear ?? null;
  // a record that doesn't say which year its values are for: they're current
  if (year == null || currentYear == null || year === currentYear) return current;
  const h = cad.valueHistory?.find((v) => v.year === year);
  if (!h) return null;
  return {
    landValue: h.landValue,
    improvementValue: h.improvementValue,
    totals: [h.marketValue, h.appraisedValue].filter((v): v is number => v != null),
  };
}

/**
 * Every claimed detail against the county record. `what` names the source in
 * messages ("The document" / "The saved property").
 */
export function compareToCounty(
  what: string,
  claimed: ClaimedFacts,
  cad: CadFacts,
  opts: { requireAll?: boolean; checkSums?: boolean; yearFallback?: boolean } = {},
): VerificationFlag[] {
  const flags: VerificationFlag[] = [];
  const flag = (code: string, message: string, severity: "high" | "medium" = "high") =>
    flags.push({ code, source: "county", severity, message });
  const missing = (label: string) =>
    opts.requireAll && flag(`missing_${label.replace(/\s+/g, "_")}`, `${what} doesn't show the ${label}.`, "medium");

  if (claimed.accountNumber) {
    if (cad.accountNumber && !sameAccount(claimed.accountNumber, cad.accountNumber))
      flag("account_mismatch", `${what}'s account number (${claimed.accountNumber}) isn't the county's (${cad.accountNumber}).`);
  } else missing("account number");

  if (claimed.ownerName) {
    if (cad.ownerName && !sameOwner(claimed.ownerName, cad.ownerName))
      flag("owner_mismatch", `${what} names "${claimed.ownerName}" as owner; the county record says "${cad.ownerName}".`);
  } else missing("owner");

  if (claimed.address) {
    if (cad.propertyAddress && !sameAddress(claimed.address, cad.propertyAddress))
      flag("address_mismatch", `${what}'s address (${claimed.address}) isn't the county's (${cad.propertyAddress}).`);
  } else missing("property address");

  const hasValues =
    claimed.landValue != null || claimed.improvementValue != null || claimed.totalValue != null;
  if (!hasValues) {
    missing("values");
    return flags;
  }
  // A saved property's tax_year is the protest year, which can be ahead of
  // the county's latest values — compare with those then. A document states
  // its own year, so it must match that year exactly.
  const county = countyYear(cad, claimed.taxYear) ?? (opts.yearFallback ? countyYear(cad, null) : null);
  if (!county) {
    flag(
      "year_unconfirmed",
      `The county record has no ${claimed.taxYear} values to compare ${what.toLowerCase()} with.`,
      "medium",
    );
    return flags;
  }
  const year = claimed.taxYear ? ` for ${claimed.taxYear}` : "";
  if (claimed.landValue != null && county.landValue != null && !close(claimed.landValue, county.landValue))
    flag("land_value_mismatch", `${what}'s land value${year} (${money(claimed.landValue)}) isn't the county's (${money(county.landValue)}).`);
  if (
    claimed.improvementValue != null &&
    county.improvementValue != null &&
    !close(claimed.improvementValue, county.improvementValue)
  )
    flag(
      "improvement_value_mismatch",
      `${what}'s improvement value${year} (${money(claimed.improvementValue)}) isn't the county's (${money(county.improvementValue)}).`,
    );
  const claimedTotals = [claimed.totalValue, claimed.appraisedValue].filter((v): v is number => v != null);
  if (claimedTotals.length && county.totals.length && !claimedTotals.some((c) => county.totals.some((t) => close(c, t))))
    flag(
      "total_value_mismatch",
      `${what}'s total value${year} (${money(claimedTotals[0])}) isn't the county's (${county.totals.map(money).join(" / ")}).`,
    );
  // a document whose own figures don't add up
  if (
    opts.checkSums &&
    claimed.landValue != null &&
    claimed.improvementValue != null &&
    claimed.totalValue != null &&
    !close(claimed.landValue + claimed.improvementValue, claimed.totalValue) &&
    (claimed.appraisedValue == null || claimed.totalValue !== claimed.appraisedValue)
  )
    flags.push({
      code: "values_dont_add_up",
      source: "ai",
      severity: "medium",
      message: `${what}'s land + improvement (${money(claimed.landValue + claimed.improvementValue)}) doesn't equal its total (${money(claimed.totalValue)}).`,
    });
  return flags;
}

/** No flags: verified. Any flag: staff review — or "test" for an admin's own account. */
export function decide(flags: VerificationFlag[], ownerIsAdmin: boolean): VerificationStatus {
  if (flags.length === 0) return "verified";
  return ownerIsAdmin ? "test" : "needs_review";
}
