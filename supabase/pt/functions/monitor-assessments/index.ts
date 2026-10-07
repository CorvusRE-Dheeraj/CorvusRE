// Automated annual "assessment changed" monitoring. Daily (pg_cron, 08:00
// UTC), for EVERY property — the least recently checked first —
// free, screened or subscribed — re-read the county record through
// cad-lookup and ask _shared/assessment-monitor.ts whether the assessment
// changed: a new tax year's value (the annual notice) or a revision.
//
// For each change: log it in assessment_changes (once per value), bring the
// property row up to date (values, tax year, value history) and clear its
// savings estimate so the dashboard recomputes it and the free portfolio
// screening re-sorts the property; then email each owner one digest, unless
// they've turned assessment alerts off. The dashboard shows unseen changes.
//
// Only pg_cron (service-role key as Bearer) may run it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isServiceRoleRequest,
  serviceRoleOnlyResponse,
} from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import {
  describeChange,
  detectAssessmentChange,
  protestDeadlineEstimate,
  type AssessmentChange,
} from "../_shared/assessment-monitor.ts";
import { increaseLabel } from "../_shared/tax-increase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type PropertyRow = {
  id: string;
  user_id: string;
  address: string;
  cad: string | null;
  account_number: string | null;
  tax_year: number | null;
  total_value: number | null;
  land_value: number | null;
  improvement_value: number | null;
  value_history: Array<Record<string, unknown>> | null;
  protest_deadline: string | null;
};

type Found = {
  property: PropertyRow;
  change: AssessmentChange;
  deadline: string | null;
};

// Spacing between county lookups.
const PACE_MS = 400;
// Each run re-checks the properties checked longest ago, so a growing
// portfolio stays inside the function's time limit; the daily schedule
// still reaches every property every few days at most.
const MAX_PER_RUN = 60;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
  const admin = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true; // detect only — no writes, no email
  const today = new Date().toISOString().slice(0, 10);

  const { data: props, error } = await admin
    .from("properties")
    .select(
      "id, user_id, address, cad, account_number, tax_year, total_value, land_value, improvement_value, value_history, protest_deadline",
    )
    .not("cad", "is", null)
    .not("account_number", "is", null)
    .order("assessment_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);
  if (error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });

  const found: Found[] = [];
  let checked = 0;
  // Function-to-function calls are rate-limited per request ("Rate limit
  // exceeded for trace … Retry after Nms"), so the job paces its lookups and
  // waits out a limit rather than skipping the property.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const lookup = async (p: PropertyRow): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      try {
        await sleep(PACE_MS);
        return await fetch(`${supabaseUrl}/functions/v1/cad-lookup`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cad: p.cad, accountNumber: p.account_number }),
        });
      } catch (err) {
        const wait = Number(/Retry after (\d+)ms/.exec(String(err))?.[1]);
        if (!Number.isFinite(wait) || attempt >= 2) throw err;
        await sleep(Math.min(wait, 20_000) + 250);
      }
    }
  };

  let failed = 0;
  const failures: { address: string; reason: string }[] = [];
  for (const p of (props ?? []) as PropertyRow[]) {
    try {
      const res = await lookup(p);
      checked++;
      if (!res.ok) {
        failed++;
        failures.push({
          address: p.address,
          reason: `cad-lookup ${res.status}`,
        });
        continue;
      }
      const json = await res.json();
      const r = json?.record;
      // Checked, even when the county returns no record, so the next run
      // moves on to other properties.
      if (!dryRun)
        await admin
          .from("properties")
          .update({ assessment_checked_at: new Date().toISOString() })
          .eq("id", p.id);
      if (!r) continue;
      const history = Array.isArray(r.valueHistory) ? r.valueHistory : [];
      const change = detectAssessmentChange(
        {
          taxYear: p.tax_year,
          totalValue: p.total_value == null ? null : Number(p.total_value),
          landValue: p.land_value == null ? null : Number(p.land_value),
          improvementValue:
            p.improvement_value == null ? null : Number(p.improvement_value),
        },
        {
          taxYear: r.taxYear ?? null,
          totalValue: r.totalValue ?? null,
          landValue: r.landValue ?? null,
          improvementValue: r.improvementValue ?? null,
          valueHistory: history.map((h: Record<string, number | null>) => ({
            year: Number(h.year),
            total: h.appraisedValue ?? h.marketValue ?? null,
          })),
        },
      );
      if (!change) continue;
      const deadline =
        change.kind === "new_year"
          ? protestDeadlineEstimate(change.taxYear, today)
          : null;
      found.push({ property: p, change, deadline });
      if (dryRun) continue;

      const { data: inserted } = await admin
        .from("assessment_changes")
        .upsert(
          {
            property_id: p.id,
            user_id: p.user_id,
            kind: change.kind,
            tax_year: change.taxYear,
            prior_year: change.priorYear,
            prior_value: change.priorValue,
            new_value: change.newValue,
            change_pct: change.changePct,
            level: change.level,
            protest_deadline_estimate: deadline,
          },
          {
            onConflict: "property_id,tax_year,new_value",
            ignoreDuplicates: true,
          },
        )
        .select("id");
      if (!inserted || inserted.length === 0) {
        found.pop(); // already logged (and emailed) on an earlier run
        continue;
      }

      // Bring the property record up to date; the dashboard recomputes the
      // savings estimate (and the screening) from the new value.
      const merged = new Map<number, Record<string, unknown>>();
      for (const h of p.value_history ?? []) merged.set(Number(h.year), h);
      for (const h of history) merged.set(Number(h.year), h);
      await admin
        .from("properties")
        .update({
          tax_year: change.taxYear,
          total_value: change.newValue,
          land_value: change.landValue,
          improvement_value: change.improvementValue,
          value_history: [...merged.values()].sort(
            (a, b) => Number(b.year) - Number(a.year),
          ),
          estimated_savings: null,
          savings_basis: null,
          ...(deadline &&
          (!p.protest_deadline ||
            p.protest_deadline < `${change.taxYear}-01-01`)
            ? { protest_deadline: deadline }
            : {}),
        })
        .eq("id", p.id);
    } catch (err) {
      failed++;
      failures.push({
        address: p.address,
        reason: err instanceof Error ? err.message.slice(0, 120) : "error",
      });
    }
  }

  // One email per owner.
  let emailed = 0;
  if (!dryRun && resendKey && found.length > 0) {
    const byUser = new Map<string, Found[]>();
    for (const f of found)
      byUser.set(f.property.user_id, [
        ...(byUser.get(f.property.user_id) ?? []),
        f,
      ]);
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, notification_prefs, unsubscribe_token")
      .in("id", [...byUser.keys()]);
    for (const prof of profiles ?? []) {
      const list = byUser.get(prof.id) ?? [];
      if (!prof.email || list.length === 0) continue;
      if (prof.notification_prefs?.assessment_alerts_email === false) continue;
      let token = prof.unsubscribe_token as string | null;
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "");
        await admin
          .from("profiles")
          .update({ unsubscribe_token: token })
          .eq("id", prof.id);
      }
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe-deadline-reminders?token=${token}&kind=assessment`;
      const rows = list
        .map(
          (
            f,
          ) => `<tr><td style="padding:10px 0; border-bottom:1px solid #e5e9ec;">
<div style="font-weight:600; color:#16233a;">${escapeHtml(f.property.address)}</div>
<div style="color:#475467; font-size:14px;">${escapeHtml(describeChange(f.change))}</div>
${f.change.level ? `<div style="color:#b54708; font-size:13px; font-weight:600;">${escapeHtml(increaseLabel(f.change.level))}</div>` : ""}
${f.deadline ? `<div style="color:#475467; font-size:13px;">Protest deadline: about ${escapeHtml(longDate(f.deadline))} — May 15, or 30 days after your notice was delivered if later. Check your notice for the exact date.</div>` : ""}
</td></tr>`,
        )
        .join("");
      const subject =
        list.length === 1
          ? `Assessment changed: ${list[0].property.address}`
          : `${list.length} of your property assessments changed`;
      const text = [
        "Corvus found a change in your county appraisal values:",
        "",
        ...list.map(
          (f) =>
            `- ${f.property.address}: ${describeChange(f.change)}${f.deadline ? ` Protest deadline about ${longDate(f.deadline)} (check your notice).` : ""}`,
        ),
        "",
        `Corvus has updated your properties and re-screened them: ${appUrl}/dashboard/properties`,
        "",
        `Turn off assessment alerts: ${unsubscribeUrl}`,
      ].join("\n");
      const html = emailShell({
        eyebrow: "Assessment monitoring",
        heading:
          list.length === 1
            ? "An assessment changed"
            : `${list.length} assessments changed`,
        intro:
          "Corvus regularly re-checks every property's county record. It found the change below, updated the property and re-ran its screening, so you can see whether it's worth a protest.",
        bodyRows: rows,
        ctaLabel: "Review in CorvusPT",
        ctaHref: `${appUrl}/dashboard/properties`,
        footnote:
          "Values come from the appraisal district's public record. Corvus's estimates aren't a guarantee of any outcome.",
        unsubscribeUrl,
      });
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "CorvusPT <info@corvusre.com>",
            to: [prof.email],
            subject,
            text,
            html,
          }),
        });
        if (res.ok) {
          emailed++;
          await admin
            .from("assessment_changes")
            .update({ emailed_at: new Date().toISOString() })
            .in(
              "property_id",
              list.map((f) => f.property.id),
            )
            .is("emailed_at", null);
        }
      } catch {
        // the dashboard still shows the change
      }
    }
  }

  return new Response(
    JSON.stringify({
      checked,
      failed,
      changed: found.length,
      emailed,
      dryRun,
      failures: dryRun ? failures : undefined,
      changes: dryRun
        ? found.map((f) => ({
            address: f.property.address,
            ...f.change,
            deadline: f.deadline,
          }))
        : undefined,
    }),
    { status: 200, headers: corsHeaders },
  );
});
