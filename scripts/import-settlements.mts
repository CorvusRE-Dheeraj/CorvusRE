// Imports the historical settlement database (public.settlement_stats) from
// appraisal districts' published account-level protest outcomes. Today that's
// Harris CAD, which publishes every ARB protest's initial and final value
// each year (download.hcad.org/data/CAMA/<year>/Hearing_files.zip); other
// districts publish only report-level summaries.
//
// Usage (Node 24+, from the repo root; needs `unzip` on PATH):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-settlements.mts 2022 2023 2024 2025
// Re-running a year replaces its rows (upsert on the cell key). Harris keeps
// updating the current year's file through the fall, so re-run it then.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregate,
  parseHarrisHearingLine,
  type HearingRow,
  type StatCell,
} from "../supabase/pt/functions/_shared/settlement-stats.ts";

const CAD = "Harris Central Appraisal District";
const SOURCE = "Harris CAD ARB hearing results (download.hcad.org)";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const years = process.argv.slice(2).map(Number).filter(Boolean);
if (years.length === 0)
  throw new Error("Pass one or more tax years, e.g. 2024 2025");

async function readYear(year: number): Promise<HearingRow[]> {
  const dir = mkdtempSync(join(tmpdir(), "hcad-"));
  try {
    const res = await fetch(
      `https://download.hcad.org/data/CAMA/${year}/Hearing_files.zip`,
      {
        headers: { "User-Agent": "CorvusPT settlement import" },
      },
    );
    if (!res.ok) throw new Error(`Harris ${year}: HTTP ${res.status}`);
    const zip = join(dir, "h.zip");
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const unzip = spawn("unzip", ["-p", zip, "arb_hearings_real.txt"]);
    const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
    let header: string[] | null = null;
    const rows: HearingRow[] = [];
    for await (const line of rl) {
      if (!header) {
        header = line.split("\t").map((h) => h.trim());
        continue;
      }
      const r = parseHarrisHearingLine(header, line);
      if (r && r.taxYear === year) rows.push(r);
    }
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const toRow = (c: StatCell) => ({
  cad: c.cad,
  tax_year: c.taxYear,
  property_class: c.propertyClass,
  value_band: c.valueBand,
  representation: c.representation,
  stage: c.stage,
  protests: c.protests,
  reduced: c.reduced,
  median_cut_pct: c.medianCutPct,
  p25_cut_pct: c.p25CutPct,
  p75_cut_pct: c.p75CutPct,
  median_cut_when_reduced_pct: c.medianCutWhenReducedPct,
  heard_share: c.heardShare,
  source: SOURCE,
  imported_at: new Date().toISOString(),
});

for (const year of years) {
  const rows = await readYear(year);
  const cells = aggregate(CAD, rows);
  for (let i = 0; i < cells.length; i += 500) {
    const res = await fetch(
      `${url}/rest/v1/settlement_stats?on_conflict=cad,tax_year,property_class,value_band,representation,stage`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(cells.slice(i, i + 500).map(toRow)),
      },
    );
    if (!res.ok)
      throw new Error(`Upsert ${year}: ${res.status} ${await res.text()}`);
  }
  console.log(`${year}: ${rows.length} protests → ${cells.length} cells`);
}
