// Deploy via CLI: `supabase functions deploy bd-console --no-verify-jwt`
// Also serves the Customer Support console as ?module=support
// (../_shared/handlers/support-console.ts) — Supabase allows 100 functions.
// (the proposal page is opened by a signed-out prospect; every staff action
// checks the caller itself).
//
// Business Development Admin console — server side (tables and rules in
// supabase/pt/bd-console.sql). AI runs on Gemini and only on what the caller
// may see; findings carry their sources and research date, and anything not
// in a source is labelled an assumption for staff to review.
//
//   research        prospects by county (open appraisal rolls — Collin today),
//                   by organization name (the 11 integrated CADs), or from an
//                   organization's own website (leadership, portfolio, contact)
//   ai_account      possible duplicates + suggested account details, for review
//   ai_proposal     draft a proposal from an approved template + approved pricing
//   check_proposal  departures from approved terms (deterministic + AI)
//   send_proposal   email the proposal link (blocked while it needs approval)
//   ai_message      draft a message; reports contact preferences + Marketing overlap
//   send_message    send it (respects do-not-contact / unsubscribes; logs to the CRM)
//   ai_summarize    summarize a call/meeting and suggest next steps
//   ai_insights     stalled deals, successful channels, partners needing follow-up
//   proposal (public, by token)  view / accept with a typed signature / decline
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { readOfficialSite, corpus } from "../_shared/web-retrieval.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { handle as supportConsole } from "../_shared/handlers/support-console.ts";
import { ADDITIONAL_PROPERTY_DISCOUNT, TIER_BRACKET_PRICES, TIER_LABEL, type Tier } from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: corsHeaders });
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
type Staff = { id: string; name: string; email: string; isSuper: boolean; isSupervisor: boolean };

// ── AI ─────────────────────────────────────────────────────────────────────

async function gemini(system: string, user: string, timeoutMs = 50_000): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, "AI is busy — please try again in a moment.");
    throw new Error(`Gemini API error ${res.status}`);
  }
  const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

const PRODUCT = `CorvusPT (Texas only — every Texas county is supported for property lookup; the AI evidence, filing and deadline tools are for Texas property tax protests). Plans: Owner-Managed $199/property/month (owner files with AI-prepared evidence) and Corvus-Managed $299/property/month (CorvusPT's team files and attends hearings); additional properties in the same bracket 15% off; monthly plans have a 12-month commitment (notice after 13 months, ends 60 days later); yearly upfront with 50% off the first year; properties over $5M priced individually. Pay Taxes shows bills, half-payment plans and county payment links (CorvusPT doesn't collect taxes). Savings are never guaranteed.`;

const RULES = `You support CorvusPT's Business Development team. Use ONLY the data provided. Anything not in the data is an assumption and must be listed as one. Never invent people, titles, emails, phone numbers, property counts or values. Never promise features, savings, discounts or terms that aren't in the approved terms provided. Plain, professional English.`;

// ── pricing (approved) ─────────────────────────────────────────────────────

type Pricing = {
  tier?: Tier;
  interval?: "month" | "year";
  properties?: number;
  discountPct?: number;
  commitmentMonths?: number | null;
  customTerms?: string | null;
};

function approvedMonthly(tier: Tier, properties: number): number {
  const base = TIER_BRACKET_PRICES[tier].upTo5m;
  const n = Math.max(1, properties);
  return base + (n - 1) * Math.round(base * (1 - ADDITIONAL_PROPERTY_DISCOUNT) * 100) / 100;
}

// Departures from the approved terms — each one needs a Super Admin approval.
function pricingDeviations(p: Pricing): { field: string; detail: string }[] {
  const out: { field: string; detail: string }[] = [];
  if (!p.tier || !(p.tier in TIER_BRACKET_PRICES)) out.push({ field: "plan", detail: "No approved plan selected" });
  if ((p.discountPct ?? 0) > 0) out.push({ field: "discount", detail: `Custom discount of ${p.discountPct}%` });
  const interval = p.interval ?? "month";
  const commit = p.commitmentMonths;
  if (interval === "month" && commit != null && commit !== 12) out.push({ field: "commitment", detail: `${commit}-month commitment instead of the standard 12` });
  if (interval === "year" && commit != null && commit !== 12) out.push({ field: "commitment", detail: `${commit}-month term on a yearly plan` });
  if ((p.customTerms ?? "").trim()) out.push({ field: "terms", detail: `Custom terms: ${p.customTerms!.trim().slice(0, 160)}` });
  return out;
}

// ── research ───────────────────────────────────────────────────────────────

const SODA = "https://data.texas.gov";
// counties whose full appraisal roll is open and queryable (owner portfolios)
const OPEN_ROLLS: Record<string, { catalog: string; label: string }> = {
  collin: { catalog: "Collin CAD Appraisal Data", label: "Collin CAD certified appraisal roll (Texas Open Data Portal)" },
};
const PROPERTY_FILTER: Record<string, string> = {
  commercial: "propcategorycode like 'F%'",
  multifamily: "propcategorycode like 'B%'",
  residential: "propcategorycode like 'A%'",
  land: "(propcategorycode like 'C%' or propcategorycode like 'D%')",
  any: "1=1",
};
const PUBLIC_OWNER = /\b(CITY OF|COUNTY|STATE OF|ISD|SCHOOL|COLLEGE|UNIVERSITY|USA|UNITED STATES|CHURCH|HOA|HOMEOWNERS|ASSOCIATION|AUTHORITY|DISTRICT|TOWN OF|MUD|TRANSIT|ECONOMIC DEVELOPMENT|DEVELOPMENT CORPORATION|HOSPITAL|WATER|UTILITY|FOUNDATION|MINISTRIES)\b/i;

async function sodaJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`data.texas.gov ${r.status}`);
  return (await r.json()) as T;
}

async function latestRollDataset(catalog: string): Promise<{ id: string; year: number } | null> {
  const j = await sodaJson<{ results: { resource: { id: string; name: string } }[] }>(
    `${SODA}/api/catalog/v1?q=${encodeURIComponent(catalog)}&limit=40`,
  );
  const years = (j.results ?? [])
    .map((r) => ({ id: r.resource.id, m: r.resource.name.match(/ - (\d{4})$/) }))
    .filter((x) => x.m)
    .map((x) => ({ id: x.id, year: Number(x.m![1]) }))
    .sort((a, b) => b.year - a.year);
  return years[0] ?? null;
}

type Finding = {
  name: string;
  kind: string;
  properties: number | null;
  marketValue: number | null;
  counties: string[];
  sampleAddresses?: string[];
  decisionMakers?: { name: string; title: string | null; source: string }[];
  ownership?: string | null;
  whyCorvus?: string | null;
  sources: { label: string; url: string }[];
  assumptions: string[];
};

async function countyResearch(params: Record<string, unknown>): Promise<{ findings: Finding[]; sources: { label: string; url: string }[]; coverage: string }> {
  const county = String(params.county ?? "").trim().toLowerCase().replace(/ county$/, "");
  const roll = OPEN_ROLLS[county];
  if (!roll) {
    return {
      findings: [],
      sources: [],
      coverage: `Portfolio discovery by county needs the county's full appraisal roll as open data — available for ${Object.keys(OPEN_ROLLS).map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")} today. For ${county || "this county"}, research an organization by name or website instead (owner search covers Bexar, Collin, Dallas, Denton, Fort Bend, Grayson, Harris, Montgomery, Tarrant, Travis and Williamson).`,
    };
  }
  const ds = await latestRollDataset(roll.catalog);
  if (!ds) throw new Error("The county roll isn't available right now");
  const min = Math.max(2, Math.min(500, Number(params.minProperties) || 5));
  const filter = PROPERTY_FILTER[String(params.propertyType ?? "commercial")] ?? PROPERTY_FILTER.commercial;
  const url =
    `${SODA}/resource/${ds.id}.json?$select=ownername,count(*) as n,sum(currvalmarket) as v` +
    `&$where=${encodeURIComponent(filter)}&$group=ownername&$having=count(*) >= ${min}&$order=n desc&$limit=300`;
  const rows = await sodaJson<{ ownername: string; n: string; v: string }[]>(url);
  const owners = rows.filter((r) => r.ownername && !PUBLIC_OWNER.test(r.ownername)).slice(0, 25);
  const datasetUrl = `${SODA}/d/${ds.id}`;
  const findings: Finding[] = owners.map((o) => ({
    name: o.ownername,
    kind: "property_owner",
    properties: Number(o.n),
    marketValue: Math.round(Number(o.v)),
    counties: [county[0].toUpperCase() + county.slice(1)],
    ownership: `Owner of record on the ${ds.year} roll`,
    sources: [{ label: `${roll.label}, ${ds.year}`, url: datasetUrl }],
    assumptions: [
      "Decision-makers aren't in the appraisal roll — identify them before outreach.",
      "Owner names on the roll may be separate entities under one parent — confirm before treating them as one account.",
    ],
  }));
  return {
    findings,
    sources: [{ label: `${roll.label}, ${ds.year}`, url: datasetUrl }],
    coverage: `Owners with at least ${min} ${String(params.propertyType ?? "commercial")} properties in ${findings[0]?.counties[0] ?? county}, from the ${ds.year} certified roll (public entities left out).`,
  };
}

async function organizationResearch(params: Record<string, unknown>) {
  const name = String(params.organization ?? "").trim();
  if (name.length < 3) throw new HttpError(400, "Enter the organization's name.");
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/cad-owner-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
    body: JSON.stringify({ ownerName: name }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = (await r.json().catch(() => ({}))) as {
    matches?: { ownerName: string | null; propertyAddress: string; cad: string; totalValue: number | null; accountNumber?: string | null }[];
  };
  const matches = data.matches ?? [];
  const byOwner = new Map<string, typeof matches>();
  for (const m of matches) {
    const k = (m.ownerName ?? name).toUpperCase();
    byOwner.set(k, [...(byOwner.get(k) ?? []), m]);
  }
  const findings: Finding[] = [...byOwner.entries()].slice(0, 15).map(([owner, ms]) => ({
    name: owner,
    kind: "property_owner",
    properties: ms.length,
    marketValue: ms.reduce((s, m) => s + (m.totalValue ?? 0), 0) || null,
    counties: [...new Set(ms.map((m) => m.cad.replace(/ (Central )?Appraisal District$/, "")))],
    sampleAddresses: ms.slice(0, 5).map((m) => m.propertyAddress),
    ownership: "Owner of record at the appraisal district",
    sources: [...new Set(ms.map((m) => m.cad))].map((c) => ({ label: `${c} public parcel data`, url: "" })),
    assumptions: ["Only the 11 integrated counties are searched; holdings elsewhere in Texas aren't counted."],
  }));
  return {
    findings,
    sources: findings.flatMap((f) => f.sources),
    coverage: "Owner-name search across the 11 counties CorvusPT reads directly (Bexar, Collin, Dallas, Denton, Fort Bend, Grayson, Harris, Montgomery, Tarrant, Travis, Williamson).",
  };
}

async function websiteResearch(params: Record<string, unknown>) {
  const url = String(params.url ?? "").trim();
  if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(url)) throw new HttpError(400, "Enter the organization's website address (https://…).");
  const { pages } = await readOfficialSite(url, /about|team|leadership|people|contact|portfolio|properties|company|management/i, { maxPages: 5, maxPdfs: 0 });
  if (pages.length === 0) throw new HttpError(422, "That website couldn't be read.");
  const out = await gemini(
    `${RULES}\nYou read an organization's own website pages. Return ONLY JSON: {"name": <organization name as the site states it>, "kind": one of "property_owner"|"management_company"|"broker"|"investment_group"|"partner"|"other", "description": <one or two sentences>, "texasPresence": <what the pages say about Texas properties/markets, or null>, "portfolio": <what the pages say about portfolio size or property types, or null>, "decisionMakers": [{"name": <as written>, "title": <as written or null>, "page": <the page URL it's on>}], "contact": {"phone": <or null>, "email": <or null>, "address": <or null>}, "whyCorvus": <why CorvusPT could help them, based only on the pages and the product description, or null>, "assumptions": [<anything you inferred that the pages don't state>]}`,
    `PRODUCT: ${PRODUCT}\n\n${pages.map((p) => `=== PAGE ${p.url} ===\n${p.text.slice(0, 15000)}`).join("\n\n")}`,
  );
  const c = corpus(pages);
  const text = c.text.toLowerCase();
  const people = (Array.isArray(out.decisionMakers) ? out.decisionMakers : [])
    .map((d) => d as { name?: string; title?: string; page?: string })
    .filter((d) => d.name && text.includes(String(d.name).toLowerCase()))
    .map((d) => ({ name: String(d.name), title: d.title ? String(d.title) : null, source: c.urls.has(String(d.page)) ? String(d.page) : pages[0].url }));
  const finding: Finding = {
    name: String(out.name ?? params.organization ?? new URL(url).hostname),
    kind: String(out.kind ?? "other"),
    properties: null,
    marketValue: null,
    counties: [],
    decisionMakers: people,
    ownership: (out.portfolio as string) ?? null,
    whyCorvus: (out.whyCorvus as string) ?? null,
    sources: pages.map((p) => ({ label: p.url, url: p.url })),
    assumptions: [
      ...(Array.isArray(out.assumptions) ? out.assumptions.map(String) : []),
      ...(out.texasPresence ? [] : ["The website doesn't say the organization holds Texas property — confirm before outreach."]),
    ],
  };
  return { findings: [finding], sources: finding.sources, coverage: (out.description as string) ?? "" };
}

// ── handlers ───────────────────────────────────────────────────────────────

async function staffFrom(req: Request, admin: SupabaseClient) {
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const { data: p } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, is_admin, bd_admin, bd_supervisor")
    .eq("id", user.id)
    .maybeSingle();
  if (!p || !(p.is_admin || p.bd_admin)) throw new HttpError(403, "Business Development access only.");
  const me: Staff = {
    id: p.id,
    email: p.email,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email,
    isSuper: !!p.is_admin,
    isSupervisor: !!(p.is_admin || p.bd_supervisor),
  };
  return { me, caller };
}

async function sendEmail(to: string, subject: string, text: string, cta?: { label: string; href: string }, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  const html = emailShell({
    eyebrow: "CorvusPT",
    heading: subject,
    intro: escapeHtml(text).replace(/\n/g, "<br/>"),
    ...(cta ? { ctaLabel: cta.label, ctaHref: cta.href } : {}),
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CorvusPT <info@corvusre.com>", reply_to: replyTo ?? "info@corvusre.com", to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// Can we write to this contact, and is Marketing already writing to them?
async function contactCheck(admin: SupabaseClient, leadId: string) {
  const { data: l } = await admin
    .from("marketing_leads")
    .select("id, full_name, email, unsubscribed_at, dnc_at, dnc_reason, email_consent, outreach_paused_at, account_id, profile_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!l) throw new HttpError(404, "Contact not found.");
  const blocked = l.dnc_at ? `Do not contact${l.dnc_reason ? ` (${l.dnc_reason})` : ""}` : l.unsubscribed_at ? "Unsubscribed from email" : l.email_consent === "withdrawn" ? "Email consent withdrawn" : !l.email ? "No email address" : null;
  const { data: f } = await admin
    .from("marketing_followups")
    .select("due_at, subject, channel")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .lte("due_at", new Date(Date.now() + 7 * 864e5).toISOString())
    .order("due_at")
    .limit(3);
  const { data: lastMkt } = await admin
    .from("marketing_activities")
    .select("created_at, summary, kind")
    .eq("lead_id", leadId)
    .not("kind", "like", "bd_%")
    .gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  const overlap = [
    ...(f ?? []).map((x) => `Marketing has a ${x.channel} follow-up due ${String(x.due_at).slice(0, 10)}: ${x.subject ?? ""}`),
    ...(lastMkt ?? []).map((x) => `Marketing contacted them ${String(x.created_at).slice(0, 10)}: ${x.summary}`),
  ];
  return { lead: l, blocked, overlap, paused: !!l.outreach_paused_at };
}

async function log(admin: SupabaseClient, me: Staff, e: { entity: string; id?: string | null; action: string; summary: string; lead?: string | null; profile?: string | null }) {
  await admin.rpc("log_record_event", {
    p_department: "business_development",
    p_entity_type: e.entity,
    p_entity_id: e.id ?? null,
    p_action: e.action,
    p_summary: e.summary,
    p_profile: e.profile ?? null,
    p_lead: e.lead ?? null,
    p_actor: me.id,
  });
}

async function handleStaff(action: string, b: Record<string, unknown>, me: Staff, caller: SupabaseClient, admin: SupabaseClient) {
  const appUrl = appBaseUrl();
  switch (action) {
    case "research": {
      const mode = String(b.mode ?? "county");
      const params = { ...b, action: undefined };
      const { data: row } = await admin.from("bd_research").insert({ requested_by: me.id, params }).select("id").single();
      try {
        const r = mode === "organization" ? await organizationResearch(b) : mode === "website" ? await websiteResearch(b) : await countyResearch(b);
        // why CorvusPT, for the data-derived findings, grounded in the numbers only
        if (r.findings.length && mode !== "website") {
          const ai = await gemini(
            `${RULES}\nFor each owner below, write one sentence on why CorvusPT could help, using only the property count, value and counties given and the product description. Return ONLY JSON: {"items": [{"name": <as given>, "whyCorvus": <one sentence>}], "summary": <two sentences on this list>}`,
            `PRODUCT: ${PRODUCT}\nPARTNER CATEGORY (if any): ${String(b.partnerCategory ?? "")}\n\n${JSON.stringify(r.findings.map((f) => ({ name: f.name, properties: f.properties, marketValue: f.marketValue, counties: f.counties })))}`,
          ).catch(() => ({ items: [] as unknown[] }));
          const why = new Map(((ai.items as { name: string; whyCorvus: string }[]) ?? []).map((x) => [x.name, x.whyCorvus]));
          for (const f of r.findings) f.whyCorvus = why.get(f.name) ?? null;
          (r as { summary?: string }).summary = (ai as { summary?: string }).summary;
        }
        await admin
          .from("bd_research")
          .update({ status: "done", findings: r.findings, sources: r.sources, coverage_note: r.coverage, summary: (r as { summary?: string }).summary ?? null, researched_at: new Date().toISOString() })
          .eq("id", row!.id);
        return { id: row!.id, ...r };
      } catch (e) {
        await admin.from("bd_research").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", row!.id);
        throw e;
      }
    }
    case "ai_account": {
      const id = String(b.accountId ?? "");
      const { data: a } = await caller.from("crm_accounts").select("*").eq("id", id).maybeSingle();
      if (!a) throw new HttpError(404, "Account not found.");
      const { data: others } = await caller.from("crm_accounts").select("id, name, website, kind").is("merged_into", null).neq("id", id).limit(1000);
      const domain = (u: string | null) => (u ? u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null);
      const cand = (others ?? []).filter((o) => {
        const n1 = String(a.name).toLowerCase().replace(/[^a-z0-9]/g, "");
        const n2 = String(o.name).toLowerCase().replace(/[^a-z0-9]/g, "");
        return (domain(a.website) && domain(a.website) === domain(o.website)) || n1.slice(0, 6) === n2.slice(0, 6) || n1.includes(n2) || n2.includes(n1);
      }).slice(0, 15);
      let info: Record<string, unknown> = {};
      let sources: string[] = [];
      if (a.website) {
        try {
          const w = await websiteResearch({ url: a.website, organization: a.name });
          const f = w.findings[0];
          info = { kind: f.kind, description: w.coverage, decisionMakers: f.decisionMakers, portfolio: f.ownership };
          sources = f.sources.map((s) => s.url);
        } catch {
          /* site unreadable — duplicates only */
        }
      }
      const ai = cand.length
        ? await gemini(
            `${RULES}\nWhich of these candidate accounts are probably the SAME organization as the target? Return ONLY JSON: {"duplicates": [{"id": <candidate id>, "reason": <short>}]}`,
            JSON.stringify({ target: { name: a.name, website: a.website, kind: a.kind }, candidates: cand }),
          ).catch(() => ({ duplicates: [] }))
        : { duplicates: [] };
      const dups = ((ai.duplicates as { id: string; reason: string }[]) ?? [])
        .filter((d) => cand.some((c) => c.id === d.id))
        .map((d) => ({ ...d, name: cand.find((c) => c.id === d.id)!.name }));
      const suggestions = { duplicates: dups, info, sources, at: new Date().toISOString() };
      await admin.from("crm_accounts").update({ ai_suggestions: suggestions }).eq("id", id);
      return suggestions;
    }
    case "ai_proposal": {
      const { data: o } = await caller.from("bd_opportunities").select("*, crm_accounts(name, kind, counties)").eq("id", String(b.opportunityId ?? "")).maybeSingle();
      if (!o) throw new HttpError(404, "Opportunity not found.");
      const { data: t } = await caller.from("bd_proposal_templates").select("*").eq("id", String(b.templateId ?? "")).eq("approved", true).maybeSingle();
      if (!t) throw new HttpError(400, "Pick an approved template.");
      const pricing = (b.pricing ?? {}) as Pricing;
      const tier = (pricing.tier ?? o.plan_tier ?? "owner_managed") as Tier;
      const n = Math.max(1, Number(pricing.properties ?? o.est_property_count ?? 1));
      const monthly = approvedMonthly(tier, n);
      const out = await gemini(
        `${RULES}\nDraft a proposal in Markdown for this prospect from the APPROVED template. Keep the approved product description and terms word for word in their own sections; you may tailor only the introduction and a short "Your portfolio" section using the opportunity data. Include a pricing table with exactly the figures given. Do not add discounts, guarantees, features or terms that aren't given. Return ONLY JSON: {"title": <title>, "body": <markdown>}`,
        JSON.stringify({
          template: t,
          organization: o.crm_accounts,
          opportunity: { title: o.title, kind: o.kind, estimatedProperties: o.est_property_count, requirements: o.requirements },
          pricing: { plan: TIER_LABEL[tier], properties: n, monthlyTotal: monthly, firstPropertyMonthly: TIER_BRACKET_PRICES[tier].upTo5m, additionalPropertyDiscount: "15%", interval: pricing.interval ?? o.billing_interval ?? "month", yearlyFirstYear: Math.round(monthly * 12 * 0.5), yearlyAfter: Math.round(monthly * 12) },
          staffNotes: String(b.notes ?? ""),
        }),
        60_000,
      );
      return { title: String(out.title ?? `Proposal — ${o.title}`), body: String(out.body ?? ""), pricing: { ...pricing, tier, properties: n, monthlyTotal: monthly } };
    }
    case "check_proposal": {
      const { data: p } = await caller.from("bd_proposals").select("*, bd_proposal_templates(terms, product)").eq("id", String(b.proposalId ?? "")).maybeSingle();
      if (!p) throw new HttpError(404, "Proposal not found.");
      const devs = pricingDeviations((p.pricing ?? {}) as Pricing);
      const tpl = (p as unknown as { bd_proposal_templates?: { terms?: string; product?: string } }).bd_proposal_templates;
      const ai = await gemini(
        `${RULES}\nCompare the proposal text with the APPROVED terms and product description. List every departure: different prices or discounts, different commitment/cancellation terms, promised features not in the product description, guaranteed savings, custom obligations. Return ONLY JSON: {"departures": [{"field": "price"|"discount"|"commitment"|"feature"|"guarantee"|"terms", "detail": <short quote or description>}]}`,
        JSON.stringify({ approvedProduct: tpl?.product ?? PRODUCT, approvedTerms: tpl?.terms ?? "", approvedPricing: PRODUCT, proposal: p.body }),
      ).catch(() => ({ departures: [] }));
      const all = [...devs, ...(((ai.departures as { field: string; detail: string }[]) ?? []).slice(0, 10).map((d) => ({ field: String(d.field), detail: String(d.detail), ai: true })))];
      await admin.from("bd_proposals").update({ deviations: all }).eq("id", p.id);
      return { deviations: all };
    }
    case "send_proposal": {
      const { data: p } = await admin.from("bd_proposals").select("*, bd_opportunities(id, title, primary_lead_id)").eq("id", String(b.proposalId ?? "")).maybeSingle();
      if (!p) throw new HttpError(404, "Proposal not found.");
      const devs = [...pricingDeviations((p.pricing ?? {}) as Pricing), ...((Array.isArray(p.deviations) ? p.deviations : []) as unknown[])];
      if (devs.length && p.status !== "approved") {
        throw new HttpError(409, "This proposal departs from the approved terms — it needs Super Admin approval before it's sent.");
      }
      if (!["draft", "approved"].includes(p.status)) throw new HttpError(409, `This proposal is ${p.status}.`);
      const opp = (p as unknown as { bd_opportunities: { id: string; title: string; primary_lead_id: string | null } }).bd_opportunities;
      const leadId = String(b.leadId ?? opp.primary_lead_id ?? "");
      const c = await contactCheck(admin, leadId);
      if (c.blocked) throw new HttpError(409, `Can't email this contact: ${c.blocked}.`);
      const link = `${appUrl}/proposal?t=${p.token}`;
      await sendEmail(
        c.lead.email!,
        `${p.title}`,
        `Hi ${String(c.lead.full_name ?? "").split(" ")[0] || "there"},\n\n${String(b.message ?? "Here is our proposal for your review.")}\n\nYou can read it, accept it or ask questions here: ${link}\n\n${me.name}\nCorvusPT`,
        { label: "Open the proposal", href: link },
        me.email,
      );
      await admin.from("bd_proposals").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: c.lead.email }).eq("id", p.id);
      await admin.from("marketing_activities").insert({ lead_id: c.lead.id, kind: "bd_proposal_sent", summary: `Proposal v${p.version} sent: ${p.title}`, created_by: me.id });
      await admin.from("bd_opportunities").update({ last_activity_at: new Date().toISOString() }).eq("id", opp.id);
      return { ok: true, overlap: c.overlap };
    }
    case "contact_check": {
      return await contactCheck(admin, String(b.leadId ?? ""));
    }
    case "ai_message": {
      const leadId = b.leadId ? String(b.leadId) : null;
      const check = leadId ? await contactCheck(admin, leadId) : null;
      const { data: o } = b.opportunityId
        ? await caller.from("bd_opportunities").select("title, stage, next_action, kind, est_property_count, requirements, crm_accounts(name)").eq("id", String(b.opportunityId)).maybeSingle()
        : { data: null };
      const { data: acts } = b.opportunityId
        ? await caller.from("bd_activities").select("kind, subject, outcome, ai_summary, completed_at").eq("opportunity_id", String(b.opportunityId)).eq("status", "done").order("completed_at", { ascending: false }).limit(8)
        : { data: [] };
      const out = await gemini(
        `${RULES}\nDraft a short business email from ${me.name} at CorvusPT. Return ONLY JSON: {"subject": <subject>, "body": <email body signed by ${me.name}>}`,
        JSON.stringify({ purpose: String(b.purpose ?? "follow up"), contact: check?.lead ? { name: check.lead.full_name } : null, opportunity: o, recentActivity: acts, product: PRODUCT }),
      );
      return { subject: String(out.subject ?? ""), body: String(out.body ?? ""), blocked: check?.blocked ?? null, overlap: check?.overlap ?? [] };
    }
    case "send_message": {
      const leadId = String(b.leadId ?? "");
      const c = await contactCheck(admin, leadId);
      if (c.blocked) throw new HttpError(409, `Can't email this contact: ${c.blocked}.`);
      if (c.overlap.length && b.confirmOverlap !== true) {
        return { ok: false, needsConfirm: true, overlap: c.overlap };
      }
      const subject = String(b.subject ?? "").trim();
      const text = String(b.body ?? "").trim();
      if (!subject || text.length < 5) throw new HttpError(400, "Write the subject and message.");
      await sendEmail(c.lead.email!, subject, text, undefined, me.email);
      await admin.from("marketing_activities").insert({ lead_id: leadId, kind: "bd_email", summary: subject, body: text, created_by: me.id });
      if (b.opportunityId) await admin.from("bd_opportunities").update({ last_activity_at: new Date().toISOString() }).eq("id", String(b.opportunityId));
      await log(admin, me, { entity: "communication", action: "email_sent", summary: `${me.name} emailed ${c.lead.full_name ?? c.lead.email}: ${subject}`, lead: leadId, profile: c.lead.profile_id });
      return { ok: true };
    }
    case "ai_summarize": {
      const notes = String(b.notes ?? "").trim();
      if (notes.length < 10) throw new HttpError(400, "Add the notes from the call or meeting first.");
      const out = await gemini(
        `${RULES}\nSummarize these call/meeting notes for the CRM and suggest next steps. Return ONLY JSON: {"summary": <3-5 sentences>, "outcome": <one line>, "nextSteps": [{"action": <what>, "due": <YYYY-MM-DD or null, only if the notes say when>}], "featureRequests": [<anything they asked for that CorvusPT doesn't offer per the product description — to record, not promise>]}`,
        `PRODUCT: ${PRODUCT}\nTODAY: ${new Date().toISOString().slice(0, 10)}\nNOTES:\n${notes.slice(0, 8000)}`,
      );
      if (b.activityId) await caller.from("bd_activities").update({ ai_summary: String(out.summary ?? ""), notes }).eq("id", String(b.activityId));
      return out;
    }
    case "ai_insights": {
      const from = String(b.from ?? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
      const to = String(b.to ?? new Date().toISOString().slice(0, 10));
      const [{ data: stats }, { data: dash }] = await Promise.all([
        caller.rpc("bd_analytics", { p_from: from, p_to: to, p_staff: null }),
        caller.rpc("bd_dashboard"),
      ]);
      return await gemini(
        `${RULES}\nAnalyse the Business Development pipeline for a supervisor. Keep forecasts (estimated) separate from actual revenue. Return ONLY JSON: {"headline": <one sentence>, "stalled": [{"opportunity": <title>, "why": <evidence>, "suggestion": <next step>}], "channels": [{"channel": <name>, "evidence": <numbers>}], "partners": [{"partner": <name>, "why": <needs follow-up or performing well>}]}`,
        JSON.stringify({ period: { from, to }, stats, dashboard: dash }).slice(0, 80_000),
      );
    }
  }
  throw new HttpError(400, "Unknown action");
}

// Public: the prospect's view of a sent proposal.
async function proposalPublic(b: Record<string, unknown>, req: Request, admin: SupabaseClient) {
  const token = String(b.token ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(400, "invalid_link");
  const { data: p } = await admin
    .from("bd_proposals")
    .select("id, title, body, status, version, sent_at, viewed_at, signed_at, signer_name, opportunity_id, bd_opportunities(account_id, crm_accounts(name))")
    .eq("token", token)
    .maybeSingle();
  if (!p || !["sent", "accepted", "signed", "declined", "superseded"].includes(p.status)) throw new HttpError(404, "invalid_link");
  const org = (p as unknown as { bd_opportunities?: { crm_accounts?: { name?: string } } }).bd_opportunities?.crm_accounts?.name ?? null;
  const op = String(b.op ?? "view");
  if (op === "view") {
    if (!p.viewed_at && p.status === "sent") await admin.from("bd_proposals").update({ viewed_at: new Date().toISOString() }).eq("id", p.id);
    return { title: p.title, body: p.body, status: p.status, version: p.version, organization: org, signedAt: p.signed_at, signerName: p.signer_name };
  }
  if (p.status !== "sent") throw new HttpError(409, p.status === "superseded" ? "A newer version of this proposal was sent — please use that link." : `This proposal is already ${p.status}.`);
  if (op === "accept") {
    const name = String(b.signerName ?? "").trim();
    if (name.length < 3 || b.agree !== true) throw new HttpError(400, "Type your full name and tick the box to sign.");
    const at = new Date().toISOString();
    await admin
      .from("bd_proposals")
      .update({ status: "signed", signer_name: name, signer_title: String(b.signerTitle ?? "").trim() || null, signed_at: at })
      .eq("id", p.id);
    await admin.rpc("log_record_event", {
      p_department: "business_development", p_entity_type: "proposal", p_entity_id: p.id, p_action: "proposal_signed",
      p_summary: `Proposal v${p.version} signed by ${name}${org ? ` (${org})` : ""} — from ${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown IP"}`,
    });
    return { ok: true, status: "signed" };
  }
  if (op === "decline") {
    await admin.from("bd_proposals").update({ status: "declined", declined_reason: String(b.reason ?? "").slice(0, 1000) || null }).eq("id", p.id);
    return { ok: true, status: "declined" };
  }
  throw new HttpError(400, "Unknown op");
}

Deno.serve(async (req: Request) => {
  // The Customer Support console shares this slot (100-function limit).
  if (new URL(req.url).searchParams.get("module") === "support") return supportConsole(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "proposal") return json(await proposalPublic(body, req, admin));
    const { me, caller } = await staffFrom(req, admin);
    if (action.startsWith("ai_") || action === "research") {
      const limited = await rateLimitUser(me.id, "bd-ai", 120, corsHeaders);
      if (limited) return limited;
    }
    return json(await handleStaff(action, body, me, caller, admin));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("bd-console failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
