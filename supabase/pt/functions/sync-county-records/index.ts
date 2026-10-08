// County portal integration: reads the appraisal district's own published
// protest records back into open cases. Daily (pg_cron, 09:00 UTC).
//
// Harris CAD publishes every protest it received, each ARB hearing's
// scheduled and actual dates, and each final value with its release date,
// refreshed weekly (download.hcad.org/data/CAMA/<year>/Hearing_files.zip).
// For each open Harris case, the job streams that file — keeping only rows
// for the accounts it needs — stores the county's record
// (county_case_records), and fills what the case doesn't have yet
// (_shared/county-records.ts: only empty fields, only forward), logging
// each change and notifying the owner.
//
// Only pg_cron (service-role key as Bearer) may run it. POST { dryRun: true }
// reports what it would change without writing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Unzip, UnzipInflate } from "https://esm.sh/fflate@0.8.2";
import {
  isServiceRoleRequest,
  serviceRoleOnlyResponse,
} from "../_shared/service-role-only.ts";
import {
  parseHarrisHearing,
  parseHarrisProtest,
  planCaseUpdate,
  type CaseFields,
  type CountyRecord,
} from "../_shared/county-records.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const HARRIS = "Harris Central Appraisal District";
const SOURCE = "Harris CAD published protest and ARB hearing records";
const FILES = ["arb_protest_real.txt", "arb_hearings_real.txt"];

// Streams the year's zip and returns the lines of each wanted file whose
// account is one we're looking for (plus each file's header row).
async function harrisLines(
  year: number,
  accounts: Set<string>,
): Promise<Record<string, { header: string; lines: string[] }>> {
  const res = await fetch(
    `https://download.hcad.org/data/CAMA/${year}/Hearing_files.zip`,
    {
      headers: { "User-Agent": "CorvusPT county records sync" },
    },
  );
  if (!res.ok || !res.body)
    throw new Error(`Harris ${year}: HTTP ${res.status}`);
  const out: Record<string, { header: string; lines: string[] }> = {};
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (!FILES.includes(file.name)) return;
    const decoder = new TextDecoder();
    const acc = { header: "", lines: [] as string[] };
    out[file.name] = acc;
    let rest = "";
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      const text = rest + decoder.decode(chunk, { stream: !final });
      const parts = text.split(/\r?\n/);
      rest = final ? "" : (parts.pop() ?? "");
      for (const line of parts) {
        if (!acc.header) {
          acc.header = line;
          continue;
        }
        const tab = line.indexOf("\t");
        if (tab > 0 && accounts.has(line.slice(0, tab).trim()))
          acc.lines.push(line);
      }
    };
    file.start();
  };
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    unzip.push(value);
  }
  unzip.push(new Uint8Array(0), true);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;

  try {
    const { data: cases, error } = await admin
      .from("protests")
      .select(
        "id, user_id, property_id, status, tax_year, hearing_date, hearing_completed_at, final_value, arb_decision_date, properties!inner(cad, account_number)",
      )
      .neq("status", "resolved")
      .not("tax_year", "is", null)
      .ilike("properties.cad", "Harris%");
    if (error) throw error;
    type Case = CaseFields & {
      id: string;
      user_id: string;
      property_id: string;
      tax_year: number;
      properties: { cad: string; account_number: string | null };
    };
    const open = ((cases ?? []) as unknown as Case[]).filter(
      (c) => c.properties?.account_number,
    );
    if (open.length === 0)
      return new Response(
        JSON.stringify({ cases: 0, matched: 0, updated: 0 }),
        {
          headers: corsHeaders,
        },
      );

    const results: {
      protestId: string;
      events: string[];
      patch: Partial<CaseFields>;
    }[] = [];
    for (const year of [...new Set(open.map((c) => c.tax_year))]) {
      const yearCases = open.filter((c) => c.tax_year === year);
      const accounts = new Set(
        yearCases.map((c) => c.properties.account_number!.trim()),
      );
      const files = await harrisLines(year, accounts);
      const protests = new Map(
        (files["arb_protest_real.txt"]?.lines ?? [])
          .map(parseHarrisProtest)
          .filter((x): x is NonNullable<typeof x> => !!x)
          .map((x) => [x.account, x]),
      );
      const header = (files["arb_hearings_real.txt"]?.header ?? "")
        .split("\t")
        .map((h) => h.trim());
      const hearings = new Map(
        (files["arb_hearings_real.txt"]?.lines ?? [])
          .map((l) => parseHarrisHearing(header, l))
          .filter((x): x is NonNullable<typeof x> => !!x && x.taxYear === year)
          .map((x) => [x.account, x]),
      );

      for (const c of yearCases) {
        const acct = c.properties.account_number!.trim();
        const p = protests.get(acct);
        const h = hearings.get(acct);
        if (!p && !h) continue;
        const record: CountyRecord = {
          account: acct,
          taxYear: year,
          protestedAt: p?.protestedAt ?? null,
          protestedBy: p?.protestedBy ?? null,
          scheduledHearing: h?.scheduledHearing ?? null,
          actualHearing: h?.actualHearing ?? null,
          releaseDate: h?.releaseDate ?? null,
          stage: h?.stage ?? null,
          initialValue: h?.initialValue ?? null,
          finalValue: h?.finalValue ?? null,
          withdrawn: h?.withdrawn ?? false,
        };
        const plan = planCaseUpdate(c, record, HARRIS);
        results.push({ protestId: c.id, ...plan });
        if (dryRun) continue;

        await admin.from("county_case_records").upsert({
          protest_id: c.id,
          user_id: c.user_id,
          property_id: c.property_id,
          cad: HARRIS,
          account: acct,
          tax_year: year,
          protested_at: record.protestedAt,
          protested_by: record.protestedBy,
          scheduled_hearing: record.scheduledHearing,
          actual_hearing: record.actualHearing,
          release_date: record.releaseDate,
          stage: record.stage,
          initial_value: record.initialValue,
          final_value: record.finalValue,
          withdrawn: record.withdrawn,
          source: SOURCE,
          synced_at: new Date().toISOString(),
        });
        if (Object.keys(plan.patch).length > 0)
          await admin.from("protests").update(plan.patch).eq("id", c.id);
        if (plan.events.length > 0) {
          await admin.from("case_audit_events").insert(
            plan.events.map((summary) => ({
              protest_id: c.id,
              user_id: c.user_id,
              kind: "county_communication",
              summary,
              detail: { source: SOURCE },
              occurred_at: new Date().toISOString(),
            })),
          );
          await admin.from("user_reminders").insert({
            user_id: c.user_id,
            property_id: c.property_id,
            remind_on: new Date().toISOString().slice(0, 10),
            note: plan.events.join(" "),
            source: "system",
          });
        }
      }
    }
    return new Response(
      JSON.stringify({
        cases: open.length,
        matched: results.length,
        updated: results.filter((r) => Object.keys(r.patch).length > 0).length,
        dryRun,
        results: dryRun ? results : undefined,
      }),
      { headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "error" }),
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
