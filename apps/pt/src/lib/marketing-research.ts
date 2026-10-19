// Corvus AI lead research: fills in what public appraisal records can tell us,
// links the owner's other properties, and asks the AI for priority + next
// action. Every filled detail records its source; anything uncertain becomes a
// flag for staff to verify instead of being written as fact.
import { supabase } from "./supabase";
import { cadLookup, type CadRecord } from "./cad-lookup";
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
} from "./marketing";
import {
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

function priorValue(r: CadRecord): number | null {
  const hist = [...(r.valueHistory ?? [])].sort((a, b) => b.year - a.year);
  const cur = r.valueYear ?? r.taxYear ?? hist[0]?.year;
  const prev = hist.find((h) => cur != null && h.year < cur);
  return prev ? (prev.appraisedValue ?? prev.marketValue ?? null) : null;
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
  priorValue: priorValue(r),
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
  let linked = 0;
  let candidates = 0;
  const owners = splitOwners(name).slice(0, 2);
  const have = new Set(props.map((p) => p.dedupeKey));
  const add: PropertyInput[] = [];
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
            leadId: lead.id,
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
  if (add.length) linked = await addProperties(add);

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
  const priority =
    (["high", "medium", "low"] as const).find((p) => p === ai.priority) ?? base.priority;
  const staffSetAction = !!lead.nextAction && lead.fieldSources.nextAction?.source === "Staff";
  const days = Number.isFinite(ai.nextActionInDays)
    ? Math.max(0, Math.min(60, Number(ai.nextActionInDays)))
    : base.dueInDays;
  Object.assign(patch, {
    priority,
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
