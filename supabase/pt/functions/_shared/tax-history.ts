// Shared by property-tax-history: the per-year history shape, and Collin's exact
// history from the Texas Open Data Portal (see that function's header).

export const YEARS = 6; // the current tax year + the five before it
export const CURRENT_TAX_YEAR = 2026; // keep in step with src/lib/tax-calendar.ts

export type TaxHistoryYear = {
  year: number;
  marketValue: number | null;
  appraisedValue: number | null;
  taxableValue: number | null;
  rate: number | null; // combined, per $100
  tax: number | null;
  // true: value × adopted rates with no exemptions involved, or the amount as
  // printed by the CAD; false: exemptions apply that the data doesn't size
  exact: boolean;
  units?: { code: string; name: string; rate: number }[];
};

export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Collin (Texas Open Data Portal) ─────────────────────────────────────────

const SODA = "https://data.texas.gov";

async function sodaJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`data.texas.gov ${r.status}`);
  return (await r.json()) as T;
}

async function collinDatasets(): Promise<Map<number, string>> {
  const j = await sodaJson<{ results: { resource: { id: string; name: string } }[] }>(
    `${SODA}/api/catalog/v1?q=${encodeURIComponent("Collin CAD Appraisal Data")}&limit=40`,
  );
  const out = new Map<number, string>();
  for (const r of j.results ?? []) {
    const m = r.resource.name.match(/^Collin CAD Appraisal Data - (\d{4})$/);
    if (m) out.set(Number(m[1]), r.resource.id);
  }
  return out;
}

export async function collinHistory(account: string): Promise<{ years: TaxHistoryYear[]; sourceUrl: string }> {
  const datasets = await collinDatasets();
  const wanted = Array.from({ length: YEARS }, (_, i) => CURRENT_TAX_YEAR - i).filter((y) => datasets.has(y));
  const rows = await Promise.all(
    wanted.map(async (y) => {
      const r = await sodaJson<Record<string, string>[]>(
        `${SODA}/resource/${datasets.get(y)}.json?propid=${encodeURIComponent(account)}&$select=propyear,currvalmarket,currvalappraised,currvalassessed,entitycodes,exemptcodes,propstatus`,
      ).catch(() => []);
      return r[0] ? { year: y, row: r[0] } : null;
    }),
  );
  const found = rows.filter((r): r is { year: number; row: Record<string, string> } => !!r);
  const codes = [...new Set(found.flatMap((f) => (f.row.entitycodes ?? "").split(",").map((c) => c.trim()).filter(Boolean)))];
  const rates = codes.length
    ? await sodaJson<{ year: string; entitycode: string; entityname: string; tottaxrate?: string }[]>(
        `${SODA}/resource/6jr2-fr7b.json?$where=${encodeURIComponent(
          `entitycode in (${codes.map((c) => `'${c.replace(/'/g, "")}'`).join(",")}) and year >= ${CURRENT_TAX_YEAR - YEARS}`,
        )}&$select=year,entitycode,entityname,tottaxrate&$limit=500`,
      )
    : [];
  const rateOf = new Map(rates.map((r) => [`${r.year}|${r.entitycode}`, r]));
  const years = found
    .map(({ year, row }): TaxHistoryYear => {
      const taxable = num(row.currvalassessed);
      const units = (row.entitycodes ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((code) => {
          const r = rateOf.get(`${year}|${code}`);
          return { code, name: r?.entityname ?? code, rate: num(r?.tottaxrate) };
        });
      const allRates = units.length > 0 && units.every((u) => u.rate != null);
      const rate = allRates ? Math.round(units.reduce((s, u) => s + (u.rate as number), 0) * 1e6) / 1e6 : null;
      return {
        year,
        marketValue: num(row.currvalmarket),
        appraisedValue: num(row.currvalappraised),
        taxableValue: taxable,
        rate,
        tax: taxable != null && rate != null ? round2((taxable * rate) / 100) : null,
        exact: !(row.exemptcodes ?? "").trim(),
        units: units.filter((u) => u.rate != null) as { code: string; name: string; rate: number }[],
      };
    })
    .sort((a, b) => b.year - a.year);
  return {
    years,
    sourceUrl: `${SODA}/browse?q=${encodeURIComponent("Collin CAD Appraisal Data")}`,
  };
}

// ── The standard "Value History" table (esearch / True Automation sites) ─────
//
// Most Texas CADs run one of two vendor sites (esearch.<cad>/Property/View/<id>
// and <cad>.trueautomation.com/clientdb/Property.aspx), and both print the same
// table: Year | Improvements | Land | Market | Ag Valuation | Appraised |
// HS Cap Loss | Assessed — with six numbers per year (Market is never filled,
// it's improvements + land). Read straight from the page, no AI: every value
// is the CAD's own printed number. Tax isn't on the page, so it stays null.
export function parseValueHistory(html: string): TaxHistoryYear[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const at = text.search(/Value History/i);
  if (at < 0) return [];
  // the table ends at the next section heading
  const section = text.slice(at, at + 4000).split(/Deed History|Property Deed|Taxing Jurisdiction|Improvement \/ Building/i)[0];
  const n = String.raw`\$?\s?[\d,]+(?:\.\d+)?`;
  const row = new RegExp(String.raw`\b(\d{4})\s+(${n})\s+(${n})\s+(${n})\s+(${n})\s+(${n})\s+(${n})`, "g");
  const out: TaxHistoryYear[] = [];
  for (const m of section.matchAll(row)) {
    const year = Number(m[1]);
    if (year < 1990 || year > CURRENT_TAX_YEAR) continue;
    const [imp, land, , appraised, , assessed] = m.slice(2, 8).map((v) => num(v));
    if (out.some((y) => y.year === year)) continue;
    out.push({
      year,
      marketValue: imp != null && land != null ? imp + land : null,
      appraisedValue: appraised,
      taxableValue: assessed,
      rate: null,
      tax: null,
      exact: true,
    });
  }
  return out.sort((a, b) => b.year - a.year).slice(0, YEARS);
}

// ── TrueProdigy counties (public CAD API) ────────────────────────────────────
//
// Denton, Montgomery, Tarrant and Travis publish their records through the
// TrueProdigy public API (their websites are JavaScript apps a page read
// can't see). The property search returns one row per tax year. Same token
// flow as cad-lookup's enrichTrueProdigy.
export const TRUEPRODIGY_OFFICE: Record<string, string> = {
  denton: "Denton",
  montgomery: "Montgomery",
  tarrant: "Tarrant",
  travis: "Travis",
};

export async function trueProdigyHistory(
  office: string,
  account: string,
): Promise<{ years: TaxHistoryYear[]; sourceUrl: string } | null> {
  const pid = parseInt(account, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const base = "https://prod-container.trueprodigyapi.com";
  const auth = await fetch(`${base}/trueprodigy/cadpublic/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ office }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!auth.ok) return null;
  const token = ((await auth.json()) as { user?: { token?: string } }).user?.token;
  if (!token) return null;
  const res = await fetch(`${base}/public/property/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    // the API needs the value as a string
    body: JSON.stringify({ pid: { operator: "=", value: String(pid) } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const rows = ((await res.json()) as { results?: Record<string, unknown>[] }).results ?? [];
  const seen = new Set<number>();
  const years = rows
    .map((r): TaxHistoryYear | null => {
      const year = num(r.pYear);
      if (!year || year > CURRENT_TAX_YEAR || seen.has(year)) return null;
      seen.add(year);
      const market = num(r.marketValue);
      const appraised = num(r.appraisedValue);
      const taxable = num(r.netAppraisedValue) ?? num(r.assessedValue);
      if (market == null && appraised == null) return null;
      return {
        year,
        marketValue: market,
        appraisedValue: appraised,
        taxableValue: taxable,
        rate: null,
        tax: null,
        exact: true,
      };
    })
    .filter((y): y is TaxHistoryYear => !!y)
    .sort((a, b) => b.year - a.year)
    .slice(0, YEARS);
  return { years, sourceUrl: `${base}/public/property/${pid}` };
}

