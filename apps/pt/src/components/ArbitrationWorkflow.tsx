import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AskAiMicButton } from "@/components/AskAiMicButton";
import { MarkdownLite } from "@/components/MarkdownLite";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import type { ProtestCase } from "@/lib/protest-case";
import { closeCase, markArbitrationFiled } from "@/lib/protest-case";
import { DECISION_DOCUMENT_TYPE, uploadDocument, type DocumentRecord } from "@/lib/documents";
import {
  extractDecisionDocument,
  getLatestDecisionNotice,
  saveDecisionNotice,
  type DecisionNoticeRecord,
  type DecisionExtraction,
} from "@/lib/decision-notice";
import { getLatestHearingNotice, type HearingNoticeRecord } from "@/lib/hearing-notice";
import { getSubmission } from "@/lib/protest-form-submissions";
import { getCachedModuleResult } from "@/lib/module-results-cache";
import { MODULES } from "@/lib/modules";
import { askAboutDocument } from "@/lib/document-ai";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { currency, updateIntake } from "@/lib/intake-store";
import { buildAiReportIntakePatch } from "@/lib/properties";
import { getErrorMessage } from "@/lib/error-message";
import {
  arbitrationImpact,
  arbitrationStages,
  buildArbitrationNumbers,
  evaluateArbitrationEligibility,
  parseBulletList,
  parseSections,
  parseMoney,
} from "@/lib/arbitration";

type Review = { weakPoints: string[]; newEvidence: string[] };
type Practice = { question: string; answer: string; feedback: string | null };

const checklistKey = (id: string) => `corvuspt.arbChecklist.${id}`;
const ARBITRATION_INFO_URL = "https://www.texas.gov/propertytaxarbitration";
const PROTESTS_OVERVIEW_URL = "https://comptroller.texas.gov/taxes/property-tax/protests/";

function readChecks(id: string): { deposit: boolean; reviewed: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(checklistKey(id)) ?? "{}");
    return { deposit: !!v.deposit, reviewed: !!v.reviewed };
  } catch {
    return { deposit: false, reviewed: false };
  }
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString() : "—";

// The arbitration leg of a case: continues the SAME protest — everything the
// owner already gave us (property, CAD data, evidence, arguments, hearing, AI
// analysis) is reused, nothing is asked for twice. Eligibility, deadline and the
// numbers are deterministic (lib/arbitration.ts); the AI review and the practice
// Q&A are advisory. Corvus never files anything itself: the request is filed
// externally and only marked filed once the owner confirms.
export function ArbitrationWorkflow({
  userId,
  protest,
  property,
  evidenceDocuments,
  caseData,
  onUpdate,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  evidenceDocuments: DocumentRecord[];
  caseData: ProtestCase | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [requestedInput, setRequestedInput] = useState("");
  const [moduleFindings, setModuleFindings] = useState<{ title: string; finding: string }[]>([]);
  const [hearingNotice, setHearingNotice] = useState<HearingNoticeRecord | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<DecisionNoticeRecord | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [practice, setPractice] = useState<Practice[]>([]);
  const [generatingQ, setGeneratingQ] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);
  const [checks, setChecks] = useState(() => readChecks(protest.id));
  const [busy, setBusy] = useState(false);
  const [resultValue, setResultValue] = useState("");
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [resultExtraction, setResultExtraction] = useState<DecisionExtraction | null>(null);
  const [needsResultValue, setNeedsResultValue] = useState(false);

  // Everything already on the case — loaded once; nothing here is re-asked.
  useEffect(() => {
    let live = true;
    getSubmission(protest.id, "notice_of_protest")
      .then((s) => {
        const v = s?.fieldValues?.["Opinion of property value"];
        if (live && typeof v === "string" && parseMoney(v)) setRequestedInput(v);
      })
      .catch(() => {});
    getLatestHearingNotice(protest.id)
      .then((n) => live && setHearingNotice(n))
      .catch(() => {});
    getLatestDecisionNotice(protest.id)
      .then((n) => live && setDecisionNotice(n))
      .catch(() => {});
    Promise.all(
      MODULES.map(async (m) => {
        const cached = await getCachedModuleResult(property.id, m.id).catch(() => null);
        const finding = (cached?.result as { keyFinding?: string } | undefined)?.keyFinding;
        return finding ? { title: m.shortName, finding } : null;
      }),
    ).then((rows) => {
      if (live) setModuleFindings(rows.filter((r): r is { title: string; finding: string } => !!r));
    });
    return () => {
      live = false;
    };
  }, [protest.id, property.id]);

  const requestedValue = parseMoney(requestedInput);
  const eligibility = useMemo(
    () => evaluateArbitrationEligibility(property, protest, evidenceDocuments.length),
    [property, protest, evidenceDocuments.length],
  );
  const numbers = buildArbitrationNumbers(property, protest, requestedValue);
  const countyInfo = getCountyProtestInfo(property.cad);

  const auto = {
    order: protest.arbDecision != null && !!protest.arbDecisionDate,
    deadline: eligibility.status === "eligible",
    requested: requestedValue != null,
    evidence: evidenceDocuments.length > 0,
    deposit: eligibility.deposit != null,
  };
  const readyToFile = Object.values(auto).every(Boolean) && checks.deposit && checks.reviewed;
  const stages = arbitrationStages(protest, eligibility, readyToFile);
  const closed = protest.status === "resolved";
  const filed = !!protest.arbitrationFiledAt;

  function setCheck(key: "deposit" | "reviewed", value: boolean) {
    const next = { ...checks, [key]: value };
    setChecks(next);
    try {
      localStorage.setItem(checklistKey(protest.id), JSON.stringify(next));
    } catch {
      // storage blocked — the checklist just won't persist across reloads
    }
  }

  // The whole case as text, for the AI — assembled from data already on file.
  function caseContext(): string {
    const history = (property.valueHistory ?? [])
      .map(
        (h) =>
          `${h.year}: market ${h.marketValue ?? "n/a"}, appraised ${h.appraisedValue ?? "n/a"}`,
      )
      .join("; ");
    return [
      `Property: ${property.address}${property.cad ? `, ${property.cad}` : ""}; type ${property.propertyType ?? "n/a"}; account ${property.accountNumber ?? "n/a"}; owner ${property.ownerName ?? "n/a"}; tax year ${property.taxYear ?? "n/a"}.`,
      `Values: original ${numbers.originalValue ?? "n/a"}; ARB result ${numbers.arbValue ?? "n/a"} (${protest.arbDecision ?? "no decision recorded"}${protest.arbDecisionDate ? ` on ${protest.arbDecisionDate}` : ""}); owner's requested value ${numbers.requestedValue ?? "not stated"}; gap ${numbers.difference ?? "n/a"}.`,
      caseData?.strategyRecommendation
        ? `Protest strategy: ${caseData.strategyRecommendation}. ${caseData.strategyRationale ?? ""}`
        : "No protest strategy on file.",
      `Evidence already submitted (${evidenceDocuments.length}): ${evidenceDocuments.map((d) => d.fileName).join("; ") || "none"}.`,
      hearingNotice
        ? `Hearing: ${hearingNotice.hearingType ?? "hearing"} on ${hearingNotice.hearingDate ?? "n/a"}.`
        : "No hearing notice on file.",
      decisionNotice?.settlementTerms ? `ARB order terms: ${decisionNotice.settlementTerms}` : "",
      history ? `Historical assessments: ${history}.` : "",
      moduleFindings.length
        ? `AI module findings: ${moduleFindings.map((f) => `${f.title} — ${f.finding}`).join(" | ")}`
        : "",
      `Arbitration deadline: ${eligibility.deadline ?? "unknown"} (${eligibility.daysRemaining ?? "?"} days remaining).`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function runReview() {
    setReviewing(true);
    try {
      const { answer } = await askAboutDocument({
        question:
          "This owner is preparing for binding arbitration after an unsatisfactory ARB result. Review the case below. " +
          "Compare the owner's requested value with the ARB result and the evidence/arguments already submitted. " +
          "Reply in exactly this format and nothing else:\n" +
          "WEAK POINTS:\n- (up to 5 short bullets: what may need to be strengthened or addressed)\n" +
          "NEW EVIDENCE:\n- (up to 4 short bullets: ONLY genuinely new evidence not already in the case that would help; write '- None' if the existing evidence is enough)",
        context: caseContext(),
      });
      const parsed = parseSections(answer, ["WEAK POINTS", "NEW EVIDENCE"]);
      const isNone = (s: string) => /^none\b/i.test(s);
      const weakPoints = parsed["WEAK POINTS"].filter((s) => !isNone(s));
      const newEvidence = parsed["NEW EVIDENCE"].filter((s) => !isNone(s));
      if (weakPoints.length === 0 && newEvidence.length === 0 && !/none/i.test(answer)) {
        throw new Error("The AI reply couldn't be read. Please try again.");
      }
      setReview({ weakPoints, newEvidence });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not review the case."));
    } finally {
      setReviewing(false);
    }
  }

  async function generateQuestions() {
    setGeneratingQ(true);
    try {
      const { answer } = await askAboutDocument({
        question:
          "Write the 8 questions an arbitrator is most likely to ask THIS owner at a binding arbitration for this specific property and case. " +
          "Reply with a numbered list, one question per line, and no other text.",
        context: caseContext(),
      });
      const questions = parseBulletList(answer);
      if (questions.length === 0) {
        throw new Error("The AI reply couldn't be read. Please try again.");
      }
      setPractice(questions.slice(0, 8).map((q) => ({ question: q, answer: "", feedback: null })));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not generate questions."));
    } finally {
      setGeneratingQ(false);
    }
  }

  async function getFeedback(i: number) {
    const p = practice[i];
    if (!p.answer.trim()) return;
    setFeedbackFor(i);
    try {
      const { answer } = await askAboutDocument({
        question:
          `Arbitrator's question: "${p.question}"\nOwner's practice answer: "${p.answer}"\n` +
          "Give brief, constructive feedback (under 90 words): is it clear, factual and tied to the evidence? What to add or tighten?",
        context: caseContext(),
      });
      setPractice((prev) => prev.map((x, k) => (k === i ? { ...x, feedback: answer } : x)));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not get feedback."));
    } finally {
      setFeedbackFor(null);
    }
  }

  function uploadMoreEvidence() {
    updateIntake(buildAiReportIntakePatch(property));
    window.open(`${import.meta.env.BASE_URL}ai-report?openModule=evidence`, "_blank");
  }

  async function confirmFiled() {
    setBusy(true);
    try {
      const at = await markArbitrationFiled(protest.id);
      onUpdate({ arbitrationFiledAt: at });
      toast.success("Recorded — your arbitration request is marked as filed.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record this."));
    } finally {
      setBusy(false);
    }
  }

  async function finishWithResult(file: File | null, ex: DecisionExtraction | null, value: number) {
    setBusy(true);
    try {
      if (file) {
        const doc = await uploadDocument(userId, property.id, file, DECISION_DOCUMENT_TYPE);
        if (ex) await saveDecisionNotice(userId, protest.id, doc.id, ex);
      }
      await closeCase(protest.id, value);
      onUpdate({ finalValue: value, status: "resolved", closedAt: new Date().toISOString() });
      setResultFile(null);
      setResultExtraction(null);
      setNeedsResultValue(false);
      toast.success(`Arbitration result recorded — case updated to ${currency(value)}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record the result."));
    } finally {
      setBusy(false);
    }
  }

  async function handleResultFile(file: File) {
    setBusy(true);
    let ex: DecisionExtraction | null = null;
    try {
      ex = await extractDecisionDocument(property, protest, file);
    } catch {
      // unreadable by AI — ask for the value below
    }
    setBusy(false);
    const value = ex?.finalValue ?? null;
    if (value != null && value > 0) {
      await finishWithResult(file, ex, value);
      return;
    }
    setResultFile(file);
    setResultExtraction(ex);
    setNeedsResultValue(true);
  }

  const impact =
    closed && protest.finalValue != null
      ? arbitrationImpact(
          property,
          { ...protest, finalValue: numbers.arbValue },
          protest.finalValue,
        )
      : null;

  const chip =
    eligibility.status === "eligible"
      ? "bg-success/15 text-success"
      : eligibility.status === "not_eligible"
        ? "bg-destructive/10 text-destructive"
        : "bg-warning/15 text-warning-foreground";

  return (
    <div id="case-arbitration" className="grid gap-4">
      {/* Case Progress — only the current/next stage is highlighted */}
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
        {stages.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-muted-foreground/30">
                →
              </span>
            )}
            <span
              aria-current={s.state === "current" ? "step" : undefined}
              className={`rounded-full px-2.5 py-1 ${
                s.state === "current"
                  ? "bg-accent font-semibold text-accent-foreground"
                  : s.state === "done"
                    ? "text-success"
                    : "text-muted-foreground/60"
              }`}
            >
              {s.state === "done" ? "✓ " : ""}
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {/* 1. Eligibility */}
      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Arbitration eligibility</h4>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}>
            {eligibility.label}
          </span>
        </div>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
          {eligibility.reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-md bg-secondary/40 p-2.5">
            <div className="text-muted-foreground">Filing deadline</div>
            <div className="font-semibold">{fmtDate(eligibility.deadline)}</div>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <div className="text-muted-foreground">Days remaining</div>
            <div
              className={`font-semibold ${
                eligibility.daysRemaining != null && eligibility.daysRemaining <= 14
                  ? "text-destructive"
                  : ""
              }`}
            >
              {eligibility.daysRemaining == null
                ? "—"
                : eligibility.daysRemaining < 0
                  ? `Passed ${-eligibility.daysRemaining} days ago`
                  : `${eligibility.daysRemaining} days`}
            </div>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <div className="text-muted-foreground">Deposit with the request</div>
            <div className="font-semibold">
              {eligibility.deposit != null ? currency(eligibility.deposit) : "—"}
            </div>
          </div>
        </div>
        {eligibility.missing.length > 0 && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <div className="font-semibold">Needed to finish this check</div>
            <ul className="mt-1 grid gap-0.5">
              {eligibility.missing.map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {eligibility.statute}. Not legal advice — confirm the date you received the order and the
          deadline with your appraisal district.
        </p>
      </section>

      {eligibility.status === "eligible" && !closed && (
        <>
          {/* 2. Prepare for Arbitration */}
          <section className="rounded-md border border-border p-4">
            <h4 className="text-sm font-semibold">Prepare for arbitration</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Built from what&apos;s already in your case — nothing to upload again.
            </p>

            {caseData?.strategyRecommendation && (
              <div className="mt-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Main valuation argument
                </div>
                <p className="mt-0.5">
                  <strong>{caseData.strategyRecommendation}</strong>
                  {caseData.strategyRationale ? ` — ${caseData.strategyRationale}` : ""}
                </p>
              </div>
            )}

            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["Property", property.address],
                  ["County / account", `${property.cad ?? "—"} · ${property.accountNumber ?? "—"}`],
                  ["Owner", property.ownerName ?? "—"],
                  ["Original value", currency(numbers.originalValue)],
                  [
                    "ARB result",
                    `${currency(numbers.arbValue)}${protest.arbDecision ? ` (${protest.arbDecision})` : ""}`,
                  ],
                  [
                    "Your requested value",
                    requestedValue != null ? currency(requestedValue) : "Not entered",
                  ],
                  [
                    "Difference",
                    numbers.difference != null
                      ? `${currency(numbers.difference)} (${numbers.differencePct?.toFixed(1)}%)`
                      : "—",
                  ],
                  [
                    "Tax at stake / year",
                    numbers.annualTaxAtStake != null ? currency(numbers.annualTaxAtStake) : "—",
                  ],
                  [
                    "Hearing",
                    hearingNotice
                      ? `${hearingNotice.hearingType ?? "Hearing"} ${fmtDate(hearingNotice.hearingDate)}`
                      : protest.hearingDate
                        ? fmtDate(protest.hearingDate)
                        : "—",
                  ],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="rounded-md bg-secondary/40 p-2.5">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="font-medium">{v}</div>
                </div>
              ))}
            </div>

            {requestedValue == null && (
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                Your opinion of value (needed to size the gap — it wasn&apos;t on your Notice)
                <input
                  value={requestedInput}
                  onChange={(e) => setRequestedInput(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 2,500,000"
                  className="mt-1 w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
                />
              </label>
            )}

            {(property.valueHistory?.length ?? 0) > 0 && (
              <div className="mt-3 text-xs">
                <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Historical assessments
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {property.valueHistory!.slice(0, 6).map((h) => (
                    <span key={h.year} className="rounded-md bg-secondary/40 px-2 py-1">
                      {h.year}: {currency(h.appraisedValue ?? h.marketValue)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {moduleFindings.length > 0 && (
              <div className="mt-3 text-xs">
                <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Key figures from your AI modules (comps, market, valuation)
                </div>
                <ul className="mt-1 grid gap-1">
                  {moduleFindings.map((f) => (
                    <li key={f.title}>
                      <span className="font-medium">{f.title}:</span>{" "}
                      <span className="text-muted-foreground">{f.finding}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 text-xs">
              <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence already in your case ({evidenceDocuments.length})
              </div>
              <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                {evidenceDocuments.slice(0, 12).map((d) => (
                  <li key={d.id}>✓ {d.fileName}</li>
                ))}
                {evidenceDocuments.length > 12 && (
                  <li>…and {evidenceDocuments.length - 12} more</li>
                )}
              </ul>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runReview()}
                  disabled={reviewing}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  {reviewing
                    ? "Reviewing your case…"
                    : review
                      ? "Re-run AI review"
                      : "AI: review my case for arbitration"}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Compares your requested value, the ARB result, and the evidence and arguments you
                  already submitted.
                </span>
              </div>
              {review && (
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      What may need strengthening
                    </div>
                    <ul className="mt-1 grid gap-1 text-xs">
                      {review.weakPoints.length === 0 && <li>Nothing stands out.</li>}
                      {review.weakPoints.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      New evidence that could help
                    </div>
                    {review.newEvidence.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nothing more needed — your existing evidence covers it.
                      </p>
                    ) : (
                      <>
                        <ul className="mt-1 grid gap-1 text-xs">
                          {review.newEvidence.map((w, i) => (
                            <li key={i}>• {w}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={uploadMoreEvidence}
                          className="btn-outline mt-2 text-xs py-1"
                        >
                          Upload Additional Evidence
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 3. Arbitration Q&A */}
          <section className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Arbitration Q&amp;A — practice</h4>
              <button
                type="button"
                onClick={() => void generateQuestions()}
                disabled={generatingQ}
                className="btn-outline text-xs py-1.5 disabled:opacity-60"
              >
                {generatingQ
                  ? "Writing questions…"
                  : practice.length
                    ? "New questions"
                    : "Generate likely questions"}
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Questions an arbitrator may ask about this property. Answer by typing or speaking.
            </p>
            <div className="mt-3 grid gap-3">
              {practice.map((p, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium">
                    {i + 1}. {p.question}
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <textarea
                      value={p.answer}
                      onChange={(e) =>
                        setPractice((prev) =>
                          prev.map((x, k) => (k === i ? { ...x, answer: e.target.value } : x)),
                        )
                      }
                      rows={2}
                      placeholder="Type your answer, or tap the mic and speak…"
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                    />
                    <AskAiMicButton
                      onTranscript={(t) =>
                        setPractice((prev) =>
                          prev.map((x, k) => (k === i ? { ...x, answer: t } : x)),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void getFeedback(i)}
                    disabled={feedbackFor === i || !p.answer.trim()}
                    className="btn-outline mt-2 text-xs py-1 disabled:opacity-50"
                  >
                    {feedbackFor === i ? "Reviewing…" : "Get feedback"}
                  </button>
                  {p.feedback && (
                    <MarkdownLite
                      text={p.feedback}
                      className="mt-2 text-xs text-muted-foreground"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 4. Ready to file */}
          {!filed && (
            <section className="rounded-md border border-border p-4">
              <h4 className="text-sm font-semibold">Ready to file checklist</h4>
              <ul className="mt-2 grid gap-1.5 text-sm">
                {(
                  [
                    [auto.order, "ARB order and its date are on file"],
                    [auto.deadline, "Within the 60-day deadline"],
                    [auto.requested, "Your requested value is on file"],
                    [auto.evidence, "Your evidence is already in the case (no re-upload)"],
                    [
                      auto.deposit,
                      `Deposit amount known${eligibility.deposit != null ? ` — ${currency(eligibility.deposit)}` : ""}`,
                    ],
                  ] as [boolean, string][]
                ).map(([ok, label]) => (
                  <li key={label} className={ok ? "text-foreground" : "text-muted-foreground"}>
                    {ok ? "✓" : "○"} {label}
                  </li>
                ))}
                <li>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checks.deposit}
                      onChange={(e) => setCheck("deposit", e.target.checked)}
                    />
                    I have the deposit ready to submit with the request
                  </label>
                </li>
                <li>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checks.reviewed}
                      onChange={(e) => setCheck("reviewed", e.target.checked)}
                    />
                    I&apos;ve reviewed my case summary and requested value above
                  </label>
                </li>
              </ul>

              {readyToFile ? (
                <div className="mt-3 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
                  <p className="font-medium">Ready to file.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Corvus doesn&apos;t file this for you. File the Request for Binding Arbitration
                    with {property.cad ?? "your appraisal district"} (with the deposit) using the
                    links below, then come back and confirm.
                    {countyInfo?.arbContact?.phone
                      ? ` County contact: ${countyInfo.arbContact.phone}.`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <a
                      href={ARBITRATION_INFO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      Online filing (texas.gov) →
                    </a>
                    <a
                      href={PROTESTS_OVERVIEW_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      Comptroller: forms &amp; instructions →
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => void confirmFiled()}
                    disabled={busy}
                    className="btn-accent mt-3 text-xs py-1.5 disabled:opacity-60"
                  >
                    {busy ? "Saving…" : "I've filed my arbitration request"}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Finish the items above to unlock filing.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/* 5. After filing — settlement / hearing, then the result */}
      {filed && !closed && (
        <section className="rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold">Settlement / hearing</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Filed {fmtDate(protest.arbitrationFiledAt)}. An arbitrator will decide the value, and
            you may settle with the appraisal district beforehand. When you have the result — or a
            settlement — add it here.
          </p>
        </section>
      )}

      {filed && !closed && (
        <section className="rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold">Add the arbitration result</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Upload the arbitrator&apos;s award or settlement. Corvus reads the final value and
            updates this case.
          </p>
          <label
            className={`btn-accent mt-2 inline-flex cursor-pointer text-xs py-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {busy ? "Working…" : "Upload arbitration result"}
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleResultFile(f);
              }}
            />
          </label>
          {needsResultValue && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                We couldn&apos;t read the final value — enter it:
              </span>
              <input
                value={resultValue}
                onChange={(e) => setResultValue(e.target.value)}
                inputMode="decimal"
                placeholder="Final value"
                aria-label="Final value"
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const v = parseMoney(resultValue);
                  if (!v) return toast.error("Enter the final value from the document.");
                  void finishWithResult(resultFile, resultExtraction, v);
                }}
                disabled={busy}
                className="btn-accent text-xs py-1.5 disabled:opacity-60"
              >
                Save result
              </button>
            </div>
          )}
        </section>
      )}

      {/* 6. Result + next phase */}
      {closed && impact && (
        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-sm font-semibold">Arbitration result</h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Final value
              </div>
              <strong>{currency(protest.finalValue)}</strong>
              <div className="text-xs text-muted-foreground">was {currency(impact.before)}</div>
            </div>
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Reduction
              </div>
              <strong className="text-success">{currency(impact.reduction)}</strong>
              <div className="text-xs text-muted-foreground">
                {impact.reductionPct != null ? `${impact.reductionPct.toFixed(1)}% lower` : ""}
              </div>
            </div>
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Estimated tax impact
              </div>
              <strong className="text-success">
                {impact.taxSavings != null ? `${currency(impact.taxSavings)} / yr saved` : "—"}
              </strong>
              <div className="text-xs text-muted-foreground">
                Tax now ≈ {currency(impact.taxNow)}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-md bg-secondary/40 p-3 text-sm">
            <p className="font-medium">Next: ongoing tax monitoring and next year&apos;s protest</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This case is closed. Set up your property for next year&apos;s protest so you never
              miss the window.
            </p>
            <Link
              to="/dashboard/properties"
              className="btn-outline mt-2 inline-flex text-xs py-1.5"
            >
              Go to my properties
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
