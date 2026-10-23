// Corvus AI lead research: fills in what public appraisal records can tell us,
// links the owner's other properties, and asks the AI for priority + next
// action. Every filled detail records its source; anything uncertain becomes a
// flag for staff to verify instead of being written as fact.
import { supabase } from "./supabase";
import { cadLookup, cadLookupByAccount, type CadRecord } from "./cad-lookup";
import { getCadRecordUrl } from "./cad-record-url";
import { getComps } from "./cad-comps";
import { invokeEdgeFunction } from "./edge-functions";
import { searchPropertiesByOwner } from "./cad-owner-search";
import {
  addProperties,
  createLead,
  leadFacts,
  logActivity,
  runAi,
  runRules,
  toLead,
  toProperty,
  updateLead,
  updateProperty,
  type FieldSource,
  type Lead,
  type LeadInput,
  type LeadProperty,
  type MarketingData,
  type PropertyInput,
  type ResearchFlag,
  type AssessmentAnalysis,
} from "./marketing";
import {
  assessmentFlags,
  summarizeComps,
  tidyName,
  type CompsSummary,
  type ProspectGroup,
  type ProspectRecord,
  cleanCounty,
  hasMultipleOwners,
  nameSimilarity,
  propertyKey,
  recommend,
  splitAddress,
  splitOwners,
} from "./marketing-crm";
import { scoreLead } from "./marketing";

const MAX_LOOKUPS = 8;
const MAX_AUTO_LINK = 25;
const GENERIC_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|att|sbcglobal)\./i;

const now = () => new Date().toISOString();
/** End of the working day, N days from now (so "today" isn't overdue on arrival). */
const dueBy = (days: number) => {
  const d = new Date(Date.now() + days * 864e5);
  d.setHours(17, 0, 0, 0);
  return (d.getTime() > Date.now() ? d : new Date(Date.now() + 2 * 36e5)).toISOString();
};
/** Share of the shorter text's words found in the other — to skip AI flags that repeat ours. */
const overlap = (a: string, b: string) => {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const A = words(a);
  const B = words(b);
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  if (!small.size) return 0;
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size;
};
const cadSource = (r: CadRecord, confidence: number): FieldSource => ({
  source: r.cad,
  detail: r.accountNumber ? `Account ${r.accountNumber}` : null,
  confidence,
  verified: false,
  at: now(),
});

function prior(r: CadRecord): { value: number | null; year: number | null } {
  const hist = [...(r.valueHistory ?? [])].sort((a, b) => b.year - a.year);
  const cur = r.valueYear ?? r.taxYear ?? hist[0]?.year;
  const prev = hist.find((h) => cur != null && h.year < cur);
  return prev
    ? { value: prev.appraisedValue ?? prev.marketValue ?? null, year: prev.year }
    : { value: null, year: null };
}

const fromCad = (r: CadRecord) => ({
  address: r.propertyAddress || null,
  county: cleanCounty(r.cad),
  cad: r.cad,
  accountNumber: r.accountNumber,
  propertyType: r.propertyType,
  assessedValue: r.totalValue,
  landValue: r.landValue,
  improvementValue: r.improvementValue,
  taxYear: r.valueYear ?? r.taxYear,
  ownerName: r.ownerName,
  mailingAddress: r.mailingAddress ?? null,
  priorValue: prior(r).value,
  priorYear: prior(r).year,
  valueYear: r.valueYear ?? r.taxYear ?? null,
  refreshedAt: now(),
});

export type ResearchResult = {
  filled: string[];
  linked: number;
  candidates: number;
  flags: ResearchFlag[];
};

export async function researchLead(lead: Lead, data: MarketingData): Promise<ResearchResult> {
  const props = data.properties.filter((p) => p.leadId === lead.id);
  const sources: Record<string, FieldSource> = { ...lead.fieldSources };
  const flags: ResearchFlag[] = [];
  const patch: LeadInput = {};
  const filled: string[] = [];
  const records: CadRecord[] = [];
  const name = lead.company || lead.ownerNames || lead.fullName;

  // 1. Each property's county record
  for (const p of props.filter((x) => x.address && x.source !== "account").slice(0, MAX_LOOKUPS)) {
    try {
      const res = await cadLookup(p.address!);
      if (res.matched === true) {
        const r = res.record;
        records.push(r);
        await updateProperty(p.id, {
          ...fromCad(r),
          address: p.address,
          source: p.source === "manual" ? "cad" : p.source,
          sourceDetail: `${r.cad}${r.accountNumber ? ` · account ${r.accountNumber}` : ""}`,
          confidence: 0.95,
          // first look at the assessment (the full review with comparables is per property)
          ...(p.analysis
            ? {}
            : {
                analysis: {
                  flags: assessmentFlags(
                    {
                      assessedValue: r.totalValue,
                      priorValue: prior(r).value,
                      valueYear: r.valueYear ?? r.taxYear,
                      priorYear: prior(r).year,
                      protestDeadline: p.protestDeadline,
                    },
                    null,
                  ),
                  analyzedAt: now(),
                  sources: [{ label: `${r.cad} record`, url: getCadRecordUrl(r) }],
                },
                analyzedAt: now(),
              }),
        });
        if (
          name &&
          r.ownerName &&
          nameSimilarity(name, r.ownerName) < 0.5 &&
          !splitOwners(r.ownerName).some((o) => nameSimilarity(name, o) >= 0.8)
        )
          flags.push({
            field: "property",
            severity: "warning",
            message: `County lists "${r.ownerName}" as owner of ${p.address} — confirm it belongs to ${name}.`,
          });
      } else if (res.matched === "multiple") {
        flags.push({
          field: "property",
          severity: "warning",
          message: `${p.address} matches ${res.options.length} parcels with different owners (${res.options
            .map((o) => o.ownerName)
            .filter(Boolean)
            .join("; ")}) — pick the right one.`,
        });
      } else {
        flags.push({
          field: "property",
          severity: "info",
          message: `${p.address} wasn't found in the county records we cover.`,
        });
      }
    } catch {
      flags.push({
        field: "property",
        severity: "info",
        message: `Couldn't reach the county records for ${p.address} — try again later.`,
      });
    }
  }

  // 2. The owner's other properties (all covered counties)
  const have = new Set(props.map((p) => p.dedupeKey));
  const found = await linkOwnerProperties(lead.id, splitOwners(name).slice(0, 2), have);
  const linked = found.linked;
  const candidates = found.candidates;
  records.push(...found.records);
  flags.push(...found.flags);

  // 3. Lead details the records can fill
  const rec = records[0];
  if (!lead.ownerNames && rec?.ownerName) {
    patch.ownerNames = rec.ownerName;
    sources.ownerNames = cadSource(rec, 0.9);
    filled.push("owner on record");
  }
  const mailing = records.find((r) => r.mailingAddress)?.mailingAddress;
  if (!lead.mailingAddress && mailing) {
    patch.mailingAddress = mailing;
    sources.mailingAddress = {
      ...cadSource(
        records.find((r) => r.mailingAddress)!,
        0.7,
      ),
      detail: "Mailing address on the appraisal record — may be a tax agent's",
    };
    filled.push("mailing address");
    flags.push({
      field: "mailingAddress",
      severity: "info",
      message:
        "Mailing address comes from the appraisal record — it can be a tax agent or lender. Verify before mailing.",
    });
  }
  const primary = lead.propertyAddress ?? props[0]?.address;
  if (primary && (!lead.city || !lead.zip)) {
    const s = splitAddress(primary);
    if (!lead.city && s.city) {
      patch.city = s.city;
      sources.city = { source: "Property address", confidence: 0.8, at: now() };
    }
    if (!lead.zip && s.zip) {
      patch.zip = s.zip;
      sources.zip = { source: "Property address", confidence: 0.9, at: now() };
    }
  }
  const ownersOnRecord = patch.ownerNames ?? lead.ownerNames;
  if (hasMultipleOwners(ownersOnRecord))
    flags.push({
      field: "ownerNames",
      severity: "info",
      message: `Several owners on record (${ownersOnRecord}) — add the others as their own leads if they make decisions too.`,
    });
  if (!lead.email && !lead.phone)
    flags.push({
      field: "contact",
      severity: "warning",
      message:
        "No email or phone. Appraisal records don't list them — check Podio, the company website, or the Texas SOS registered agent.",
    });
  if (
    lead.email &&
    GENERIC_MAIL.test(lead.email) &&
    lead.company &&
    /\b(llc|inc|lp|ltd|corp|trust)\b/i.test(lead.company)
  )
    flags.push({
      field: "email",
      severity: "info",
      message: "Personal email on a company lead — confirm it's the decision-maker.",
    });

  // 4. Corvus AI: priority + next action, from the facts above only — re-read
  // the lead and its portfolio so the AI sees what research just filled in.
  const [fresh, freshProps] = await Promise.all([
    supabase.from("marketing_leads").select("*").eq("id", lead.id).single(),
    supabase.from("marketing_lead_properties").select("*").eq("lead_id", lead.id),
  ]);
  const after = { ...(fresh.data ? toLead(fresh.data) : lead), ...patch } as Lead;
  const portfolio = (freshProps.data ?? []).map(toProperty);
  const base = recommend(after, data, scoreLead(after, data.activities).score);
  let summary: string | null = null;
  let ai: {
    priority?: string;
    priorityReason?: string;
    nextAction?: string;
    nextActionInDays?: number;
  } = {};
  try {
    const run = await runAi({
      scope: "lead",
      leadId: lead.id,
      instruction:
        'Research summary for this CorvusPT prospect. Reply with JSON only: {"summary": "2-3 sentences: who they are, portfolio, how promising", ' +
        '"priority": "high|medium|low", "priorityReason": "one line", "nextAction": "one concrete action", "nextActionInDays": number, ' +
        '"uncertain": ["details staff should verify"]}. Base it only on the facts.',
      context:
        leadFacts(after, data.activities, data.followups) +
        `\nProperties:\n${
          portfolio
            .slice(0, 15)
            .map(
              (p) =>
                `- ${p.address ?? p.accountNumber} | ${p.county ?? "?"} County | ${p.propertyType ?? "type ?"} | assessed ${p.assessedValue ?? "?"}${p.priorValue ? ` (last year ${p.priorValue})` : ""} | owner on record ${p.ownerName ?? "?"} | ${p.verified ? "verified" : "unverified"}`,
            )
            .join("\n") || "- none"
        }` +
        `\nResearch found: ${linked} more properties linked by exact owner name, ${candidates} possible matches to verify. Flags already raised (don't repeat them): ${flags.map((f) => f.message).join(" | ") || "none"}` +
        `\nRule-based recommendation: ${base.action} (priority ${base.priority}, in ${base.dueInDays} days)`,
    });
    const m = (run.result ?? "").match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]) as typeof ai & { summary?: string; uncertain?: string[] };
      ai = j;
      summary = j.summary ?? null;
      for (const u of (j.uncertain ?? []).slice(0, 3))
        if (typeof u === "string" && u.trim() && !flags.some((f) => overlap(f.message, u) >= 0.5))
          flags.push({ field: "ai", severity: "info", message: u.trim() });
    } else summary = run.result;
  } catch {
    // AI is optional — the rule-based recommendation still applies
  }
  const staffSetAction = !!lead.nextAction && lead.fieldSources.nextAction?.source === "Staff";
  const days = Number.isFinite(ai.nextActionInDays)
    ? Math.max(0, Math.min(60, Number(ai.nextActionInDays)))
    : base.dueInDays;
  Object.assign(patch, {
    priorityReason: ai.priorityReason || base.why.join(" · ") || null,
    aiSummary: summary,
    aiSummaryAt: now(),
    researchedAt: now(),
    researchFlags: flags,
    fieldSources: sources,
    ...(staffSetAction || lead.stage === "do_not_contact"
      ? {}
      : {
          nextAction: ai.nextAction || base.action,
          nextActionAt: dueBy(days),
        }),
  } satisfies LeadInput);
  if (!staffSetAction) sources.nextAction = { source: "Corvus AI", confidence: 0.7, at: now() };
  await updateLead(lead.id, patch);
  await logActivity({
    leadId: lead.id,
    kind: "research",
    summary: `Corvus AI researched this lead${linked ? ` · linked ${linked} propert${linked === 1 ? "y" : "ies"}` : ""}${filled.length ? ` · filled ${filled.join(", ")}` : ""}`,
    body:
      flags
        .filter((f) => f.severity === "warning")
        .map((f) => `• ${f.message}`)
        .join("\n") || null,
  });
  await runRules(lead.id).catch(() => 0);
  return { filled, linked, candidates, flags };
}

/** Runs research over several leads, two at a time. */
export async function researchMany(
  leads: Lead[],
  data: MarketingData,
  onProgress: (done: number) => void,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  let done = 0;
  const queue = [...leads];
  const worker = async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      try {
        await researchLead(l, data);
        ok++;
      } catch {
        failed++;
      }
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker()]);
  return { ok, failed };
}

/** Staff confirmed a research candidate is theirs. */
export async function acceptCandidate(lead: Lead, flag: ResearchFlag): Promise<void> {
  const c = flag.candidate;
  if (!c) return;
  await addProperties([
    {
      leadId: lead.id,
      address: c.address,
      county: c.county,
      cad: c.cad,
      accountNumber: c.accountNumber,
      propertyType: c.propertyType,
      assessedValue: c.assessedValue,
      ownerName: c.ownerName,
      ...splitAddress(c.address),
      source: "research",
      sourceDetail: `Confirmed by staff from ${c.cad ?? "county records"}`,
      verified: true,
      confidence: 1,
    },
  ]);
  await dropFlag(lead, flag);
}

export async function dropFlag(lead: Lead, flag: ResearchFlag): Promise<void> {
  await updateLead(lead.id, {
    researchFlags: lead.researchFlags.filter((f) =>
      flag.id ? f.id !== flag.id : f.message !== flag.message,
    ),
  });
}

export async function verifyField(lead: Lead, field: string): Promise<void> {
  const cur = lead.fieldSources[field] ?? { source: "Staff" };
  await updateLead(lead.id, {
    fieldSources: { ...lead.fieldSources, [field]: { ...cur, verified: true, at: now() } },
    researchFlags: lead.researchFlags.filter((f) => f.field !== field),
  });
}

export async function verifyProperty(p: LeadProperty): Promise<void> {
  await updateProperty(p.id, { verified: true, confidence: 1 });
}

/** Creates a lead (+ its first property) from the Add lead form. */
export async function addLeadWithProperty(
  input: LeadInput,
  prop: { address: string; county: string; propertyType: string; value: string } | undefined,
): Promise<Lead> {
  const sources = Object.fromEntries(
    (["email", "phone", "mailingAddress", "ownerNames"] as const)
      .filter((k) => input[k])
      .map((k) => [k, { source: "Staff", verified: true, at: new Date().toISOString() }]),
  );
  const l = await createLead({ ...input, fieldSources: sources });
  if (prop && (prop.address || prop.value))
    await addProperties([
      {
        leadId: l.id,
        address: prop.address || null,
        ...splitAddress(prop.address),
        county: cleanCounty(prop.county),
        propertyType: prop.propertyType || null,
        assessedValue: prop.value ? Number(prop.value.replace(/[^0-9.]/g, "")) : null,
        source: "manual",
        sourceDetail: "Entered by staff",
        verified: true,
      },
    ]);
  await logActivity({ leadId: l.id, kind: "note", summary: "Lead added" });
  await runRules(l.id);
  return l;
}

/**
 * Searches every covered county for properties owned by these names. Exact
 * owner-name matches are linked (unverified); close ones become "to verify"
 * flags — never linked on a guess.
 */
export async function linkOwnerProperties(
  leadId: string,
  owners: string[],
  have: Set<string>,
): Promise<{ linked: number; candidates: number; records: CadRecord[]; flags: ResearchFlag[] }> {
  const add: PropertyInput[] = [];
  const flags: ResearchFlag[] = [];
  const records: CadRecord[] = [];
  let candidates = 0;
  for (const owner of owners.filter((o) => o.length >= 4)) {
    try {
      const { matches } = await searchPropertiesByOwner(owner);
      for (const r of matches) {
        const v = fromCad(r);
        const key = propertyKey(v);
        if (have.has(key)) continue;
        have.add(key);
        records.push(r);
        const sim = nameSimilarity(owner, r.ownerName);
        if (sim === 1 && add.length < MAX_AUTO_LINK) {
          add.push({
            leadId,
            ...v,
            ...splitAddress(r.propertyAddress),
            source: "research",
            sourceDetail: `Owner-name match in ${r.cad}`,
            verified: false,
            confidence: 0.85,
          });
        } else if (sim >= 0.75) {
          candidates++;
          flags.push({
            id: `cand-${key}`,
            field: "portfolio",
            severity: "warning",
            message: `Possible property: ${r.propertyAddress} (owner "${r.ownerName}", ${Math.round(sim * 100)}% name match).`,
            candidate: {
              address: v.address,
              county: v.county,
              cad: v.cad,
              accountNumber: v.accountNumber,
              propertyType: v.propertyType,
              assessedValue: v.assessedValue,
              ownerName: v.ownerName,
              confidence: Math.round(sim * 100) / 100,
            },
          });
        }
      }
    } catch {
      flags.push({
        field: "portfolio",
        severity: "info",
        message: `Owner search for "${owner}" didn't finish — try again later.`,
      });
    }
  }
  const linked = add.length ? await addProperties(add) : 0;
  return { linked, candidates, records, flags };
}

/** "Research owner" on one property: who owns it, their mailing address, what else they own. */
export async function researchPropertyOwner(lead: Lead, prop: LeadProperty, data: MarketingData) {
  const owner = prop.ownerName ?? lead.ownerNames ?? lead.company;
  if (!owner)
    throw new Error("No owner name on this property yet — refresh it from the county first.");
  const have = new Set(data.properties.filter((x) => x.leadId === lead.id).map((x) => x.dedupeKey));
  const found = await linkOwnerProperties(lead.id, splitOwners(owner).slice(0, 3), have);
  const sources = { ...lead.fieldSources };
  const patch: LeadInput = {};
  if (!lead.ownerNames) {
    patch.ownerNames = owner;
    sources.ownerNames = {
      source: prop.cad ?? "County record",
      detail: prop.accountNumber ? `Account ${prop.accountNumber}` : null,
      confidence: 0.9,
      at: now(),
    };
  }
  const mail = prop.mailingAddress ?? found.records.find((r) => r.mailingAddress)?.mailingAddress;
  if (!lead.mailingAddress && mail) {
    patch.mailingAddress = mail;
    sources.mailingAddress = {
      source: prop.cad ?? "County record",
      detail: "Mailing address on the appraisal record — may be a tax agent's",
      confidence: 0.7,
      at: now(),
    };
  }
  const multi = hasMultipleOwners(owner)
    ? [
        {
          field: "ownerNames",
          severity: "info" as const,
          message: `Several owners on ${prop.address}: ${owner} — add the others as their own leads if they decide too.`,
        },
      ]
    : [];
  await updateLead(lead.id, {
    ...patch,
    fieldSources: sources,
    researchFlags: [
      ...lead.researchFlags.filter((f) => !found.flags.some((n) => n.id && n.id === f.id)),
      ...found.flags,
      ...multi,
    ],
  });
  await logActivity({
    leadId: lead.id,
    kind: "research",
    summary: `Owner research for ${prop.address ?? "a property"}: ${found.linked} more propert${found.linked === 1 ? "y" : "ies"} linked${found.candidates ? `, ${found.candidates} to verify` : ""}`,
  });
  return found;
}

/** Re-reads one property from its county record (values, prior year, owner, mailing address). */
export async function refreshProperty(prop: LeadProperty): Promise<CadRecord | null> {
  let r: CadRecord | null = null;
  if (prop.cad && prop.accountNumber)
    r = await cadLookupByAccount(prop.cad, prop.accountNumber).catch(() => null);
  if (!r && prop.address) {
    const res = await cadLookup(prop.address);
    if (res.matched === true) r = res.record;
    else if (res.matched === "multiple")
      r =
        res.options.find((o) => o.accountNumber && o.accountNumber === prop.accountNumber) ?? null;
  }
  if (!r) return null;
  const v = fromCad(r);
  await updateProperty(prop.id, {
    ...v,
    address: prop.address ?? v.address,
    // keep a prior value we already have if the county didn't send history
    priorValue: v.priorValue ?? prop.priorValue,
    priorYear: v.priorYear ?? prop.priorYear,
    sourceDetail: `${r.cad}${r.accountNumber ? ` · account ${r.accountNumber}` : ""}`,
    confidence: Math.max(prop.confidence ?? 0, 0.95),
  });
  return r;
}

/**
 * Assessment review for one property: county record (value history), nearby
 * comparable parcels where the county publishes them, the flags, and a short
 * AI explanation. Indicators only — never a promised reduction.
 */
export async function analyzeProperty(lead: Lead, prop: LeadProperty): Promise<AssessmentAnalysis> {
  const sources: AssessmentAnalysis["sources"] = [];
  const rec = await refreshProperty(prop).catch(() => null);
  const value = rec?.totalValue ?? prop.assessedValue;
  const pr = rec ? prior(rec) : { value: prop.priorValue, year: prop.priorYear };
  const priorV = pr.value ?? prop.priorValue;
  if (rec)
    sources.push({
      label: `${rec.cad} record${rec.accountNumber ? ` ${rec.accountNumber}` : ""}`,
      url: getCadRecordUrl(rec),
    });
  else if (prop.cad) sources.push({ label: `${prop.cad} (not re-read — lookup failed)` });
  let comps: CompsSummary | null = null;
  try {
    const c = await getComps({
      cad: prop.cad ?? rec?.cad ?? undefined,
      accountNumber: prop.accountNumber ?? undefined,
      address: prop.address ?? undefined,
      totalValue: value ?? undefined,
    });
    if (c.comps.length) {
      comps = summarizeComps(
        { value, acres: c.subject?.legalAcreage ?? rec?.lotSizeAcres ?? null },
        c.comps,
      );
      sources.push({
        label: `${c.comps.length} nearby comparable parcels from the county's parcel data`,
      });
    }
  } catch {
    // comps are only published for some counties
  }
  const flags = assessmentFlags(
    {
      assessedValue: value,
      priorValue: priorV,
      valueYear: rec?.valueYear ?? prop.valueYear,
      priorYear: pr.year ?? prop.priorYear,
      protestDeadline: prop.protestDeadline,
    },
    comps,
  );
  const history = [...(rec?.valueHistory ?? [])]
    .sort((a, b) => a.year - b.year)
    .map((h) => ({ year: h.year, value: h.appraisedValue ?? h.marketValue ?? null }));
  let explanation: string | null = null;
  try {
    const r = await runAi({
      scope: "assessment",
      leadId: lead.id,
      instruction:
        "Explain in 2-3 plain sentences whether this commercial assessment looks worth reviewing for a protest, using ONLY the findings given. " +
        "Say what the indicators suggest and what evidence the owner should gather. Do not promise or estimate any reduction or savings.",
      context: [
        `Property: ${prop.address} (${prop.county ?? "?"} County, ${prop.propertyType ?? "type ?"})`,
        `Assessed: ${value ?? "?"}${priorV ? `; prior year: ${priorV}` : ""}`,
        history.length
          ? `History: ${history.map((h) => `${h.year}: ${h.value}`).join(", ")}`
          : "No value history published.",
        comps
          ? `Comparables: ${comps.count} parcels, median ${comps.median ?? "?"}, median/acre ${comps.medianPerAcre ?? "?"}, subject/acre ${comps.subjectPerAcre ?? "?"}`
          : "No comparable parcels published for this county.",
        `Findings: ${flags.map((f) => `[${f.level}] ${f.text}`).join(" ") || "none"}`,
      ].join("\n"),
    });
    explanation = r.result;
  } catch {
    // the flags stand on their own
  }
  const analysis: AssessmentAnalysis = {
    flags,
    comps,
    history,
    explanation,
    analyzedAt: now(),
    sources,
  };
  await updateProperty(prop.id, {
    analysis,
    analyzedAt: now(),
    priorValue: priorV ?? null,
    priorYear: pr.year ?? prop.priorYear,
  });
  await logActivity({
    leadId: lead.id,
    kind: "research",
    summary: `Assessment review: ${prop.address ?? "property"} — ${
      flags.filter((f) => f.level !== "info").length
        ? flags
            .filter((f) => f.level !== "info")
            .map((f) => f.kind)
            .join(", ") + " flagged"
        : "nothing flagged"
    }`,
  });
  return analysis;
}

/** Turns chosen county-search owners into leads (or adds to the owner's existing lead). */
export async function importProspects(
  groups: ProspectGroup[],
  opts: { assignTo: string | null; fetchedAt: string },
): Promise<{ created: Lead[]; updated: number; properties: number }> {
  const created: Lead[] = [];
  let updated = 0;
  let properties = 0;
  for (const g of groups) {
    if (!g.newRecords.length && g.existing) continue;
    const first = g.records[0];
    const src = {
      source: first.cad,
      detail: "County search",
      confidence: 0.95,
      verified: false,
      at: opts.fetchedAt,
    };
    let leadId = g.existing?.leadId ?? null;
    if (!leadId) {
      const l = await createLead({
        company: g.owner,
        ownerNames: first.ownerName,
        mailingAddress: g.mailingAddress,
        source: "research",
        assignedTo: opts.assignTo,
        fieldSources: {
          company: src,
          ownerNames: src,
          ...(g.mailingAddress
            ? {
                mailingAddress: {
                  ...src,
                  confidence: 0.7,
                  detail: "Mailing address on the appraisal record — may be a tax agent's",
                },
              }
            : {}),
        },
      });
      leadId = l.id;
      created.push(l);
    } else updated++;
    properties += await addProperties(
      g.newRecords.map((r) => ({
        leadId: leadId!,
        address: r.propertyAddress,
        city: tidyName(r.city),
        zip: r.zip,
        county: r.county,
        cad: r.cad,
        accountNumber: r.accountNumber,
        propertyType: r.propertyType,
        assessedValue: r.assessedValue,
        priorValue: r.priorValue,
        valueYear: r.valueYear,
        ownerName: r.ownerName,
        mailingAddress: r.mailingAddress,
        source: "cad" as const,
        sourceDetail: `${r.cad} · county search`,
        verified: true,
        confidence: 0.95,
        refreshedAt: opts.fetchedAt,
        analysis: {
          flags: assessmentFlags(
            { assessedValue: r.assessedValue, priorValue: r.priorValue, protestDeadline: null },
            null,
          ),
          analyzedAt: opts.fetchedAt,
          sources: [{ label: `${r.cad} parcel data` }],
        },
        analyzedAt: opts.fetchedAt,
      })),
    );
    await logActivity({
      leadId,
      kind: "research",
      summary: `${g.existing ? "Added" : "Created from"} ${first.county} County search: ${g.newRecords.length} propert${g.newRecords.length === 1 ? "y" : "ies"}`,
    });
    await runRules(leadId).catch(() => 0);
  }
  return { created, updated, properties };
}

export const runCountySearch = (body: {
  county?: string;
  minValue?: number;
  includeIndustrial?: boolean;
  limit?: number;
}) =>
  invokeEdgeFunction<{
    county?: string;
    cad?: string;
    sourceUrl?: string;
    fetchedAt?: string;
    minValue?: number;
    records?: ProspectRecord[];
    excluded?: number;
    counties?: string[];
  }>("admin-update-plan?action=marketing-prospects", body);
