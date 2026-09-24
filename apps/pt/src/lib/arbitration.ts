// Binding-arbitration workflow logic for a case whose formal (ARB) hearing ended
// unsatisfactorily. Deterministic where it can be: eligibility, the deadline and
// days remaining, the value gap and the workflow stage are all straight functions
// of fields already on the case, plus the statutory dataset in escalation-eval.ts
// (Tax Code §41A — $5M cap for non-homestead, 60 days from the ARB order, the
// Comptroller deposit schedule). Nothing here is an AI call; the AI review and
// practice Q&A live in the UI and are only ever advisory.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import { evaluateEscalation } from "./escalation-eval";
import { getEffectiveTaxRate } from "./texas-tax-rates";

const DAY = 24 * 60 * 60 * 1000;

// ── Eligibility ──────────────────────────────────────────────────────────
export type ArbitrationStatus = "eligible" | "not_eligible" | "needs_info";

export type ArbitrationEligibility = {
  status: ArbitrationStatus;
  label: "Potentially eligible" | "Not eligible" | "Needs additional information";
  statute: string;
  // Why — each a plain sentence.
  reasons: string[];
  // Only what is genuinely missing and needed to finish the check.
  missing: string[];
  deadline: string | null; // ISO date
  daysRemaining: number | null; // negative once passed
  expired: boolean;
  deposit: number | null;
  depositBasis: string | null;
};

const LABEL: Record<ArbitrationStatus, ArbitrationEligibility["label"]> = {
  eligible: "Potentially eligible",
  not_eligible: "Not eligible",
  needs_info: "Needs additional information",
};

function daysUntil(iso: string, now: Date): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

export function evaluateArbitrationEligibility(
  property: PropertyRecord,
  protest: ProtestRecord,
  evidenceDocumentCount: number,
  now: Date = new Date(),
): ArbitrationEligibility {
  const option = evaluateEscalation(property, protest, evidenceDocumentCount).options.find(
    (o) => o.id === "binding_arbitration",
  );
  const deadline = option?.deadline.date ?? null;
  const daysRemaining = deadline ? daysUntil(deadline, now) : null;
  const expired = daysRemaining != null && daysRemaining < 0;
  const base = {
    statute: "Tax Code §41A",
    deadline,
    daysRemaining,
    expired,
    deposit: option?.estimatedCost?.min ?? null,
    depositBasis: option?.estimatedCost?.basis ?? null,
  };

  const done = (status: ArbitrationStatus, reasons: string[], missing: string[] = []) => ({
    status,
    label: LABEL[status],
    reasons,
    missing,
    ...base,
  });

  if (protest.arbDecision == null) {
    return done(
      "needs_info",
      ["Arbitration is available after the ARB issues its order."],
      ["The ARB decision — record it on the Decision tab (upload the ARB order)."],
    );
  }
  if (protest.arbDecision === "approved") {
    return done("not_eligible", [
      "The ARB approved the protest in full, so there is nothing to appeal to arbitration.",
    ]);
  }
  if (option && !option.eligible) {
    return done("not_eligible", [option.eligibilityBasis]);
  }
  if (!protest.arbDecisionDate) {
    return done(
      "needs_info",
      [option?.eligibilityBasis ?? "Eligibility depends on the ARB order date."],
      ["The date you received the ARB order — needed to count the 60-day deadline."],
    );
  }
  if (expired) {
    return done("not_eligible", [
      `The 60-day deadline passed on ${deadline}. Verify the date you actually received the order with your appraisal district — if it differs, the deadline may too.`,
    ]);
  }
  return done("eligible", [
    option?.eligibilityBasis ?? "Property appears to qualify.",
    `The ARB ${protest.arbDecision === "denied" ? "denied the protest" : "granted only a partial reduction"}, and the request is due within 60 days of receiving the order.`,
  ]);
}

// ── Workflow stages ──────────────────────────────────────────────────────
export type ArbitrationStageId =
  | "hearing"
  | "result"
  | "eligibility"
  | "preparation"
  | "file"
  | "settlement"
  | "arbitration_result";

export const ARBITRATION_STAGES: { id: ArbitrationStageId; label: string }[] = [
  { id: "hearing", label: "Formal Hearing" },
  { id: "result", label: "Result" },
  { id: "eligibility", label: "Arbitration Eligibility" },
  { id: "preparation", label: "Arbitration Preparation" },
  { id: "file", label: "File Arbitration" },
  { id: "settlement", label: "Settlement / Hearing" },
  { id: "arbitration_result", label: "Arbitration Result" },
];

export type StageState = "done" | "current" | "upcoming";

// Only ONE stage is ever "current" — the next action. Everything before it is
// done, everything after is upcoming.
export function arbitrationStages(
  protest: ProtestRecord,
  eligibility: ArbitrationEligibility,
  readyToFile: boolean,
): { id: ArbitrationStageId; label: string; state: StageState }[] {
  let current: ArbitrationStageId;
  if (protest.status === "resolved" && protest.escalationPath === "arbitration") {
    current = "arbitration_result";
  } else if (protest.arbitrationFiledAt) {
    current = "settlement";
  } else if (protest.arbDecision == null) {
    current = "result";
  } else if (eligibility.status !== "eligible") {
    current = "eligibility";
  } else if (!readyToFile) {
    current = "preparation";
  } else {
    current = "file";
  }
  const closed = protest.status === "resolved" && protest.escalationPath === "arbitration";
  const idx = ARBITRATION_STAGES.findIndex((s) => s.id === current);
  return ARBITRATION_STAGES.map((s, i) => ({
    ...s,
    state: closed || i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}

// ── Numbers ──────────────────────────────────────────────────────────────
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type ArbitrationNumbers = {
  originalValue: number | null;
  arbValue: number | null;
  requestedValue: number | null;
  // ARB value − owner's requested value: the gap arbitration would be about.
  difference: number | null;
  differencePct: number | null;
  taxRate: number;
  // Tax at stake on that gap for one year (an estimate at the effective rate).
  annualTaxAtStake: number | null;
};

export function buildArbitrationNumbers(
  property: PropertyRecord,
  protest: ProtestRecord,
  requestedValue: number | null,
): ArbitrationNumbers {
  const originalValue = protest.originalValue ?? property.totalValue ?? null;
  const arbValue = protest.finalValue ?? null;
  const difference =
    arbValue != null && requestedValue != null ? Math.max(0, arbValue - requestedValue) : null;
  const taxRate = getEffectiveTaxRate(property.cad);
  return {
    originalValue,
    arbValue,
    requestedValue,
    difference,
    differencePct:
      difference != null && arbValue != null && arbValue > 0 ? (difference / arbValue) * 100 : null,
    taxRate,
    annualTaxAtStake: difference != null ? Math.round(difference * taxRate) : null,
  };
}

// What the arbitration result did to the case, for the final update.
export function arbitrationImpact(
  property: PropertyRecord,
  protest: ProtestRecord,
  finalValue: number,
) {
  const before = protest.finalValue ?? protest.originalValue ?? property.totalValue ?? null;
  const reduction = before != null ? Math.max(0, before - finalValue) : null;
  const rate = getEffectiveTaxRate(property.cad);
  return {
    before,
    reduction,
    reductionPct: reduction != null && before ? (reduction / before) * 100 : null,
    taxSavings: reduction != null ? Math.round(reduction * rate) : null,
    taxNow: Math.round(finalValue * rate),
    taxRate: rate,
  };
}

// ── AI helpers (advisory text handling only) ─────────────────────────────
// The shared Ask-AI function answers in bullets/prose, so the workflow asks for
// labelled bullet lists and reads those — no reliance on the model emitting JSON.
const BULLET = /^\s*(?:\d+[.)]|[-*•])\s+(.*\S)\s*$/;
const clean = (s: string) =>
  s
    .replace(/\*\*/g, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();

export function parseBulletList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => BULLET.exec(line)?.[1])
    .filter((s): s is string => !!s)
    .map(clean)
    .filter((s) => s.length > 0);
}

// Splits a reply on "HEADER:" lines into bullet lists keyed by the header.
export function parseSections<K extends string>(text: string, headers: K[]): Record<K, string[]> {
  const out = Object.fromEntries(headers.map((h) => [h, [] as string[]])) as Record<K, string[]>;
  let current: K | null = null;
  for (const line of text.split(/\r?\n/)) {
    const label = line.replace(/[*#]/g, "").trim().toUpperCase();
    const header = headers.find((h) => label.startsWith(h.toUpperCase()));
    if (header) {
      current = header;
      continue;
    }
    if (!current) continue;
    const item = BULLET.exec(line)?.[1];
    if (item) out[current].push(clean(item));
  }
  return out;
}
