// Some county sources return addresses with gaps where the city should be, e.g.
// "1515 S LOOP 288 , , TX 76208". Collapse the stray spaces and empty commas so it reads
// "1515 S LOOP 288, TX 76208". Only tidies punctuation; never changes real words.
export function tidyAddress(address: string): string {
  return address
    .replace(/\s+,/g, ",")
    .replace(/,(\s*,)+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim();
}

const KEEP_UPPER = new Set([
  "TX",
  "N",
  "S",
  "E",
  "W",
  "NE",
  "NW",
  "SE",
  "SW",
  "US",
  "FM",
  "CR",
  "SH",
  "IH",
  "PO",
  "LLC",
  "LP",
  "LTD",
]);

/**
 * County records come in ALL CAPS ("2931 PARKER RD, ST PAUL, TX 75098"), which
 * is hard to read at a glance. Title-cases them (keeping state codes,
 * directions and road prefixes like FM / CR upper-case) and splits the street
 * from the city line. Mixed-case addresses are left as they are.
 */
export function readableAddress(address: string): { street: string; place: string } {
  const tidy = tidyAddress(address);
  const letters = tidy.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 0 && letters === letters.toUpperCase();
  const cased = allCaps
    ? tidy.replace(/[A-Za-z][A-Za-z'.]*/g, (w) =>
        KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase(),
      )
    : tidy;
  // ordinals: "17Th" → "17th"
  const fixed = cased.replace(/(\d)(St|Nd|Rd|Th)\b/g, (_, d, s) => d + s.toLowerCase());
  const i = fixed.indexOf(",");
  return i < 0
    ? { street: fixed, place: "" }
    : { street: fixed.slice(0, i).trim(), place: fixed.slice(i + 1).trim() };
}
