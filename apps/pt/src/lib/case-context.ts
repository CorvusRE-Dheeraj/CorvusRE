// The whole existing case as plain text, for the advisory AI steps in the
// arbitration and court-appeal workflows. Assembled only from data already on
// file — nothing is asked of the owner again.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type { ProtestCase } from "./protest-case";
import type { DocumentRecord } from "./documents";
import type { HearingNoticeRecord } from "./hearing-notice";
import type { DecisionNoticeRecord } from "./decision-notice";

export type CaseFacts = {
  requestedValue: number | null;
  moduleFindings: { title: string; finding: string }[];
  hearingNotice: HearingNoticeRecord | null;
  decisionNotice: DecisionNoticeRecord | null;
};

export function buildCaseContext(input: {
  property: PropertyRecord;
  protest: ProtestRecord;
  caseData: ProtestCase | null;
  evidenceDocuments: DocumentRecord[];
  facts: CaseFacts;
  deadline: string | null;
  daysRemaining: number | null;
}): string {
  const { property, protest, caseData, evidenceDocuments, facts } = input;
  const arbValue = protest.finalValue ?? null;
  const gap =
    arbValue != null && facts.requestedValue != null
      ? Math.max(0, arbValue - facts.requestedValue)
      : null;
  const history = (property.valueHistory ?? [])
    .map(
      (h) => `${h.year}: market ${h.marketValue ?? "n/a"}, appraised ${h.appraisedValue ?? "n/a"}`,
    )
    .join("; ");
  return [
    `Property: ${property.address}${property.cad ? `, ${property.cad}` : ""}; type ${property.propertyType ?? "n/a"}; account ${property.accountNumber ?? "n/a"}; owner ${property.ownerName ?? "n/a"}; tax year ${property.taxYear ?? "n/a"}.`,
    `Values: original ${protest.originalValue ?? property.totalValue ?? "n/a"}; ARB result ${arbValue ?? "n/a"} (${protest.arbDecision ?? "no decision recorded"}${protest.arbDecisionDate ? ` on ${protest.arbDecisionDate}` : ""}); owner's requested value ${facts.requestedValue ?? "not stated"}; gap ${gap ?? "n/a"}.`,
    caseData?.strategyRecommendation
      ? `Protest strategy: ${caseData.strategyRecommendation}. ${caseData.strategyRationale ?? ""}`
      : "No protest strategy on file.",
    `Evidence already submitted (${evidenceDocuments.length}): ${evidenceDocuments.map((d) => d.fileName).join("; ") || "none"}.`,
    facts.hearingNotice
      ? `Hearing: ${facts.hearingNotice.hearingType ?? "hearing"} on ${facts.hearingNotice.hearingDate ?? "n/a"}.`
      : "No hearing notice on file.",
    facts.decisionNotice?.settlementTerms
      ? `ARB order terms: ${facts.decisionNotice.settlementTerms}`
      : "",
    facts.decisionNotice && facts.decisionNotice.discrepancies.length > 0
      ? `Points flagged on the ARB order: ${facts.decisionNotice.discrepancies.join("; ")}`
      : "",
    history ? `Historical assessments: ${history}.` : "",
    facts.moduleFindings.length
      ? `AI module findings: ${facts.moduleFindings.map((f) => `${f.title} — ${f.finding}`).join(" | ")}`
      : "",
    `Deadline: ${input.deadline ?? "unknown"} (${input.daysRemaining ?? "?"} days remaining).`,
  ]
    .filter(Boolean)
    .join("\n");
}
