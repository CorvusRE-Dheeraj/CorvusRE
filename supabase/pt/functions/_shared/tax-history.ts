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

