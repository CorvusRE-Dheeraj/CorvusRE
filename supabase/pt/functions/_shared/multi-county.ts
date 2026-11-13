// A property that pays taxes in two counties is saved as one record with
// both named: cad "Bexar County, Kendall County", account
// "1313473 (Bexar County) 306657 (Kendall County)" — or the account notes
// alone ("447170 - Comal County 1334687 - Bexar county"). Pay Taxes shows one
// entry per county, each with its own account, tax office and plans; the
// county tax office reader (property-tax-history) reads the right account.
// Pure — used by the app and by the edge function.

// "Bexar County" / "Bexar Appraisal District" / "Bexar CAD" / "Bexar" → "Bexar"
export function countyNameOf(part: string): string {
  return part
    .replace(/\b(central\s+)?appraisal\s+district\b/i, "")
    .replace(/\bcad\b/i, "")
    .replace(/\bcounty\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The counties a cad field names, in order. Only parts that say "County"
// (or are a whole appraisal-district name) count — "Dallas County, Garland
// ISD" is one county plus a school district, not two counties.
export function countiesIn(cad: string | null | undefined): string[] {
  if (!cad) return [];
  const parts = cad
    .split(/\s*(?:,|\/|&|;|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [countyNameOf(cad)].filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (
      !/\bcounty\b|appraisal\s+district|\bcad\b/i.test(p) &&
      parts.indexOf(p) !== 0
    )
      continue;
    if (/\b(isd|cisd|mud|city|esd)\b/i.test(p)) continue;
    const name = countyNameOf(p);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase()))
      out.push(name);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The account number noted for one county: "1313473 (Bexar County)",
// "447170 - Comal County", "Bexar: 1313473". Null when the account field
// doesn't say; the whole field when it's a single plain number.
export function accountForCounty(
  account: string | null | undefined,
  county: string,
): string | null {
  const a = (account ?? "").trim();
  if (!a) return null;
  const c = esc(county);
  const patterns = [
    new RegExp(
      `([A-Z0-9][A-Z0-9-]{2,})\\s*(?:\\(|-|–)\\s*${c}(?:\\s+county)?\\b`,
      "i",
    ),
    new RegExp(`${c}(?:\\s+county)?\\s*[:#-]\\s*([A-Z0-9][A-Z0-9-]{2,})`, "i"),
  ];
  for (const re of patterns) {
    const m = a.match(re);
    if (m) return m[1];
  }
  // no county notes at all → the field is the account
  return /county/i.test(a) ? null : a;
}

// Texas's two-word county names — anything else before "County" in an
// account note is read as one word ("- Bexar county" → Bexar).
const TWO_WORD_COUNTIES = [
  "Deaf Smith",
  "El Paso",
  "Fort Bend",
  "Jeff Davis",
  "Jim Hogg",
  "Jim Wells",
  "La Salle",
  "Live Oak",
  "Palo Pinto",
  "Red River",
  "San Augustine",
  "San Jacinto",
  "San Patricio",
  "San Saba",
  "Tom Green",
  "Van Zandt",
];

// The counties named in an account field's notes: "1313473 (Bexar County)",
// "447170 - Comal County". Only an account NUMBER next to the county counts,
// so "Harris County MUD 5" or free text isn't read as a county.
export function countiesInAccount(
  account: string | null | undefined,
): string[] {
  const a = account ?? "";
  const out: string[] = [];
  const re = /([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+county\b/gi;
  for (const m of a.matchAll(re)) {
    const words = m[1].trim().split(/\s+/);
    const two = words.length === 2 ? `${words[0]} ${words[1]}` : null;
    const hit =
      two &&
      TWO_WORD_COUNTIES.find((c) => c.toLowerCase() === two.toLowerCase());
    const raw = hit ?? words[words.length - 1];
    const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const proper = hit ?? name;
    if (accountForCounty(a, proper) == null) continue;
    if (!out.some((o) => o.toLowerCase() === proper.toLowerCase()))
      out.push(proper);
  }
  return out;
}

// The county parts of a property, when it pays taxes in more than one.
export function countyParts(
  cad: string | null | undefined,
  account: string | null | undefined,
): { county: string; accountNumber: string | null }[] {
  const counties = countiesIn(cad);
  // the account notes can name a county the cad field leaves out
  // ("447170 - Comal County 1334687 - Bexar county" with cad "Comal County")
  for (const c of countiesInAccount(account))
    if (!counties.some((o) => o.toLowerCase() === c.toLowerCase()))
      counties.push(c);
  if (counties.length < 2) return [];
  return counties.map((county) => ({
    county,
    accountNumber: accountForCounty(account, county),
  }));
}
