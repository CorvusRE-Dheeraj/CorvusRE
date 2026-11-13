import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CalendarClock,
  Calculator,
  ClipboardCheck,
  ExternalLink,
  FileStack,
  Gavel,
  Landmark,
  Sparkles,
} from "lucide-react";
import { MarkdownLite } from "@/components/MarkdownLite";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import type { ProtestCase } from "@/lib/protest-case";
import {
  markArbitrationFiled,
  recordFinalValueOnProperty,
  saveArbitration,
} from "@/lib/protest-case";
import { logCaseEvent } from "@/lib/case-audit";
import {
  DECISION_DOCUMENT_TYPE,
  getDocumentById,
  getDocumentUrl,
  uploadDocument,
  type DocumentRecord,
} from "@/lib/documents";
import { extractDecisionDocument, saveDecisionNotice } from "@/lib/decision-notice";
import { reviewDocument } from "@/lib/document-review";
import { useCaseFacts } from "@/hooks/use-case-facts";
import { buildCaseContext } from "@/lib/case-context";
import { askAboutDocument } from "@/lib/document-ai";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";
import { downloadPdf } from "@/lib/protest-documents";
import { buildAttorneyPackagePdf } from "@/lib/court-appeal-package";
import { useCountyResearch } from "@/lib/county-research";
import { CountyResearchPanel } from "@/components/CountyResearchPanel";
import {
  buildArbitrationNumbers,
  evaluateArbitrationEligibility,
  parseBulletList,
  parseMoney,
  parseSections,
} from "@/lib/arbitration";
import {
  AGENT_FORM_URL,
  AP219_URL,
  AP241_URL,
  APP_STAGES,
  ARBITRATION_PAGE_URL,
  CATEGORY_LABEL,
  LBA_PAGE_URL,
  PTAS_URL,
  WITHDRAWAL_FORM_URL,
  applicationStage,
  arbitrationCost,
  arbitrationDeadline,
  arbitrationNext,
  arbitrationUpcoming,
  awardComparison,
  categorize,
  copyEvidence,
  hearingIcs,
  newId,
  phaseStates,
  recommendedCategories,
  type ArbEvidenceItem,
  type ArbitrationData,
  type EvidenceCategory,
} from "@/lib/arbitration-case";
import { ARBITRATION_SCHEDULE_URL } from "@/lib/escalation-eval";
import { FileButton, StageTrack, StatusCard, WorkflowPopup } from "@/components/case/workflow-ui";
import { fieldClass, fmtDay } from "@/lib/workflow-format";

const ARB_EVIDENCE_TYPE = "Arbitration Evidence";
const ARB_DOC_TYPE = "Arbitration Document";

type PopupId =
  | "eligibility"
  | "assessment"
  | "cost"
  | "application"
  | "status"
  | "evidence"
  | "prepare"
  | "settlement"
  | "withdraw"
  | "arbitrator"
  | "instructions"
  | "hearing"
  | "award"
  | "final"
  | "research"
  | null;

const NO_LEGAL =
  "Give decision support only — no legal advice, no guarantee or prediction of the outcome.";

// The arbitration leg of a case, on ONE page: eligibility, AI assessment,
// cost & ROI, the application (filed externally in the Comptroller's PTAS),
// the ARB evidence packet reused as a separate arbitration copy, settlement,
// arbitrator & hearing, award, and roll correction / refund. Status, progress,
// deadlines and the next action are on the page; everything detailed opens in
// a popup that closes back to the same spot. Rules, fees and procedures come
// from the centralized county research engine; nothing is marked submitted,
// paid or confirmed without proof the owner records.
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
  const data: ArbitrationData = protest.arbitration ?? {};
  const facts = useCaseFacts(protest, property);
  const research = useCountyResearch(property.cad, "arbitration");
  const [popup, setPopup] = useState<PopupId>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [enteredValue, setEnteredValue] = useState("");

  const requestedValue = facts.requestedValue ?? parseMoney(enteredValue);
  const eligibility = useMemo(
    () => evaluateArbitrationEligibility(property, protest, evidenceDocuments.length),
    [property, protest, evidenceDocuments.length],
  );
  const numbers = buildArbitrationNumbers(property, protest, requestedValue);
  const cost = arbitrationCost(property, protest, requestedValue);
  const deadline = arbitrationDeadline(protest, data);
  const stage = applicationStage(protest, data);
  const stageIdx = APP_STAGES.findIndex((s) => s.id === stage);
  const phases = phaseStates(protest, data);
  const upcoming = arbitrationUpcoming(protest, data);
  const next = arbitrationNext(protest, data);
  const closed = protest.status === "resolved";
  const confirmed = stage === "confirmed";
  const eligibilityLabel =
    eligibility.status === "eligible"
      ? "Eligible"
      : eligibility.status === "not_eligible"
        ? "Not Eligible"
        : "Requires Verification";

  async function save(patch: Partial<ArbitrationData>) {
    const merged: ArbitrationData = { ...data, ...patch };
    await saveArbitration(protest.id, merged);
    onUpdate({ arbitration: merged });
    return merged;
  }
  async function run<T>(key: string, fn: () => Promise<T>, failure: string) {
    setBusy(key);
    try {
      return await fn();
    } catch (err) {
      toast.error(getErrorMessage(err, failure));
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  const caseContext = () =>
    buildCaseContext({
      property,
      protest,
      caseData,
      evidenceDocuments,
      facts: { ...facts, requestedValue },
      deadline: deadline.deadline,
      daysRemaining: deadline.daysRemaining,
    });
  const upload = (file: File, type = ARB_DOC_TYPE) =>
    uploadDocument(userId, property.id, file, type);
  async function openDoc(id: string | null | undefined) {
    if (!id) return;
    await run(
      "open",
      async () => {
        const doc = await getDocumentById(userId, id);
        if (!doc) throw new Error("That document isn't in your Documents any more.");
        window.open(await getDocumentUrl(doc.storagePath), "_blank", "noopener");
      },
      "Could not open the document.",
    );
  }

  // ── AI assessment (saved) ────────────────────────────────────────────
  async function assess() {
    await run(
      "assess",
      async () => {
        const { answer } = await askAboutDocument({
          question:
            `${NO_LEGAL} Assess whether binding arbitration may be worth considering for this case. Reply as short bullets under these labels: ` +
            "Values (ARB value vs owner's proposed value); Potential additional savings; Evidence strength; Risks and limitations; Practical benefits; Assessment (whether further escalation may be worth considering, and why). Use only the figures given.",
          context:
            `${caseContext()}\n\nCOST & ROI: deposit ${cost.deposit != null ? currency(cost.deposit) : "n/a"} (arbitrator fee ${cost.arbitratorFee != null ? currency(cost.arbitratorFee) : "n/a"}, $50 retained by the Comptroller); refund ${cost.refundIfCloser != null ? currency(cost.refundIfCloser) : "n/a"} if the award is closer to the owner's value; ` +
            `potential additional savings ${cost.savings != null ? `${currency(cost.savings)}/yr` : "n/a"}; ROI ${cost.roi != null ? `${cost.roi}x` : "n/a"}; eligibility: ${eligibilityLabel} — ${eligibility.reasons.join(" ")}; deadline ${deadline.deadline ?? "unknown"}.`,
        });
        await save({ assessment: { text: answer, at: new Date().toISOString() } });
      },
      "Corvus AI couldn't assess the case.",
    );
  }

  // ── Evidence (separate arbitration copy) ─────────────────────────────
  const arbEvidence = data.evidence ?? null;
  async function reuseEvidence() {
    await run(
      "evidence",
      async () => {
        await save({ evidence: copyEvidence(evidenceDocuments) });
        toast.success(
          `${evidenceDocuments.length} document${evidenceDocuments.length === 1 ? "" : "s"} copied into your arbitration packet — the ARB packet is unchanged.`,
        );
      },
      "Could not copy the evidence.",
    );
  }
  async function setItems(items: ArbEvidenceItem[]) {
    await save({ evidence: { ...(arbEvidence ?? copyEvidence([])), items } });
  }
  async function addEvidence(file: File, replace?: string) {
    await run(
      "addEvidence",
      async () => {
        const doc = await upload(file, ARB_EVIDENCE_TYPE);
        const item: ArbEvidenceItem = {
          documentId: doc.id,
          fileName: doc.fileName,
          category: categorize(doc),
          source: "added",
          addedAt: new Date().toISOString(),
        };
        const items = arbEvidence?.items ?? [];
        await setItems(
          replace ? items.map((i) => (i.documentId === replace ? item : i)) : [...items, item],
        );
        toast.success(
          replace ? "Replaced in the arbitration packet." : "Added to the arbitration packet.",
        );
      },
      "Could not add the evidence.",
    );
  }
  async function reviewEvidence() {
    await run(
      "reviewEvidence",
      async () => {
        const list = (arbEvidence?.items ?? [])
          .map((i) => `- ${i.fileName} (${CATEGORY_LABEL[i.category]})`)
          .join("\n");
        const officialDocs = research.research
          ? [...research.research.statewide, ...research.research.countySpecific]
              .filter((x) => /document|evidence|order|attach|submit/i.test(x.text))
              .map((x) => `- ${x.text}`)
              .join("\n")
          : "";
        const { answer } = await askAboutDocument({
          question:
            `${NO_LEGAL} Review this arbitration evidence packet for this property. Reply in exactly this format and nothing else:\n` +
            "STILL RELEVANT:\n- (documents in the packet that remain relevant, and why — short)\n" +
            "ADDITIONAL USEFUL EVIDENCE:\n- (evidence not in the packet that may help)\n" +
            "GAPS:\n- (missing documents or evidence gaps)\n" +
            "REQUIRED BY ARBITRATION PROCEDURE:\n- (documents the procedures below require — only if stated there; else '- None stated')",
          context: `${caseContext()}\n\nARBITRATION PACKET:\n${list || "(empty)"}\n\nOFFICIAL PROCEDURE NOTES:\n${officialDocs || "(none retrieved)"}`,
        });
        const p = parseSections(answer, [
          "STILL RELEVANT",
          "ADDITIONAL USEFUL EVIDENCE",
          "GAPS",
          "REQUIRED BY ARBITRATION PROCEDURE",
        ]);
        await save({
          evidence: {
            ...(arbEvidence ?? copyEvidence([])),
            review: {
              relevant: p["STILL RELEVANT"],
              useful: p["ADDITIONAL USEFUL EVIDENCE"],
              gaps: p["GAPS"],
              required: p["REQUIRED BY ARBITRATION PROCEDURE"].filter((s) => !/^none/i.test(s)),
              at: new Date().toISOString(),
            },
          },
        });
      },
      "Could not review the evidence.",
    );
  }
  async function downloadPacket() {
    await run(
      "packet",
      async () => {
        const items = arbEvidence?.items ?? [];
        const files = [];
        for (const i of items) {
          const doc = await getDocumentById(userId, i.documentId);
          if (!doc) continue;
          const bytes = await fetch(await getDocumentUrl(doc.storagePath)).then((r) =>
            r.arrayBuffer(),
          );
          files.push({ fileName: doc.fileName, bytes });
        }
        const byCat = new Map<EvidenceCategory, string[]>();
        for (const i of items)
          byCat.set(i.category, [...(byCat.get(i.category) ?? []), i.fileName]);
        const bytes = await buildAttorneyPackagePdf({
          title: "Arbitration Evidence Packet",
          subtitle: `${property.address} - ${property.cad ?? ""} account ${property.accountNumber ?? "—"} - tax year ${protest.taxYear ?? property.taxYear ?? "—"}`,
          sections: [
            {
              heading: "Values",
              lines: [
                `ARB-determined value: ${currency(numbers.arbValue)}`,
                `Owner's opinion of value: ${requestedValue != null ? currency(requestedValue) : "not stated"}`,
              ],
            },
            ...[...byCat.entries()].map(([c, names]) => ({
              heading: CATEGORY_LABEL[c],
              lines: names,
            })),
          ],
          evidence: files,
        });
        downloadPdf(bytes, `Arbitration-Evidence-${property.accountNumber ?? property.id}.pdf`);
      },
      "Could not build the packet.",
    );
  }

  const impact = (() => {
    const award = data.award?.value ?? (closed ? protest.finalValue : null);
    return award != null ? awardComparison(award, requestedValue, numbers.arbValue) : null;
  })();

  return (
    <div id="case-arbitration" className="grid gap-3">
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning-foreground">
        Corvus AI researches the rules, calculates costs and deadlines, and organizes your documents
        — decision support, not legal advice or a guaranteed outcome. The request is filed in the
        Texas Comptroller&apos;s arbitration system (PTAS), not in CorvusPT.
      </p>

      <StageTrack stages={phases} label="Arbitration progress" />

      {/* Status cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          title="Eligibility"
          action={{ label: "Check Eligibility", onClick: () => setPopup("eligibility") }}
          done={eligibility.status === "eligible"}
        >
          <span
            className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${
              eligibility.status === "eligible"
                ? "bg-success/15 text-success"
                : eligibility.status === "not_eligible"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-warning/15 text-warning-foreground"
            }`}
          >
            {eligibilityLabel}
          </span>
          <span className="text-muted-foreground">
            Request due {fmtDay(deadline.deadline)}
            {deadline.daysRemaining != null
              ? deadline.daysRemaining < 0
                ? " · passed"
                : ` · ${deadline.daysRemaining} days left`
              : ""}
          </span>
        </StatusCard>

        <StatusCard
          icon={<Sparkles className="h-4 w-4" />}
          title="AI assessment"
          action={{
            label: "View AI Assessment",
            onClick: () => {
              setPopup("assessment");
              if (!data.assessment) void assess();
            },
          }}
          done={!!data.assessment}
        >
          <span>
            ARB {currency(numbers.arbValue)} vs yours{" "}
            {requestedValue != null ? currency(requestedValue) : "—"}
          </span>
          <span className="text-muted-foreground">
            Potential savings {cost.savings != null ? `${currency(cost.savings)}/yr (est.)` : "—"}
          </span>
        </StatusCard>

        <StatusCard
          icon={<Calculator className="h-4 w-4" />}
          title="Cost & ROI"
          action={{ label: "Calculate Cost & ROI", onClick: () => setPopup("cost") }}
        >
          <span>
            Deposit {cost.deposit != null ? currency(cost.deposit) : "—"}
            {cost.roi != null ? ` · ROI ${cost.roi}×` : ""}
          </span>
          <span className="text-muted-foreground">
            {cost.refundIfCloser != null
              ? `${currency(cost.refundIfCloser)} back if the award is closer to your value`
              : "—"}
          </span>
        </StatusCard>

        <StatusCard
          icon={<Landmark className="h-4 w-4" />}
          title="Application"
          action={
            stage === "not_started" || stage === "in_progress"
              ? {
                  label:
                    stage === "not_started"
                      ? "Start Arbitration Application"
                      : "Continue Application",
                  onClick: () => setPopup("application"),
                  disabled: eligibility.status === "not_eligible",
                }
              : { label: "View status & receipts", onClick: () => setPopup("status") }
          }
          done={confirmed}
        >
          <ol className="grid gap-0.5 text-xs">
            {APP_STAGES.map((s, i) => (
              <li
                key={s.id}
                className={
                  i < stageIdx
                    ? "text-success"
                    : i === stageIdx
                      ? "font-semibold"
                      : "text-muted-foreground"
                }
              >
                {i < stageIdx ? "✓" : i === stageIdx ? "●" : "○"} {s.label}
              </li>
            ))}
          </ol>
        </StatusCard>

        <StatusCard
          icon={<FileStack className="h-4 w-4" />}
          title="Evidence"
          action={
            arbEvidence
              ? { label: "Prepare Arbitration Evidence", onClick: () => setPopup("prepare") }
              : {
                  label: "Reuse Evidence for Arbitration",
                  onClick: () => void reuseEvidence(),
                  disabled: busy === "evidence",
                }
          }
          secondary={[
            { label: "View Existing Evidence Packet", onClick: () => setPopup("evidence") },
          ]}
          done={!!arbEvidence}
        >
          <span>
            ARB packet: {evidenceDocuments.length} document
            {evidenceDocuments.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">
            {arbEvidence
              ? `Arbitration copy: ${arbEvidence.items.length} (${arbEvidence.items.filter((i) => i.source === "added").length} added)`
              : "No arbitration copy yet — reuse, don't re-upload."}
          </span>
        </StatusCard>

        <StatusCard
          icon={<Gavel className="h-4 w-4" />}
          title={closed || data.award ? "Award & final" : "Settlement & hearing"}
          action={
            closed || data.award
              ? { label: "Final case tracking", onClick: () => setPopup("final") }
              : confirmed
                ? data.arbitrator?.hearingDate
                  ? { label: "Prepare for Arbitration Hearing", onClick: () => setPopup("hearing") }
                  : { label: "Settlement period", onClick: () => setPopup("settlement") }
                : undefined
          }
          secondary={
            confirmed && !closed && !data.award
              ? [
                  { label: "Add Arbitrator Details", onClick: () => setPopup("arbitrator") },
                  { label: "Upload Arbitration Award", onClick: () => setPopup("award") },
                ]
              : undefined
          }
          done={!!data.award || closed}
        >
          {data.award || closed ? (
            <span>
              Award {currency(data.award?.value ?? protest.finalValue)}
              {impact?.closerToOwner != null
                ? impact.closerToOwner
                  ? " · closer to your value"
                  : " · closer to the ARB value"
                : ""}
            </span>
          ) : confirmed ? (
            <>
              <span>
                {data.settlement?.endDate
                  ? `Settlement ends ${fmtDay(data.settlement.endDate)}`
                  : "Settlement period — add its dates from your notice"}
              </span>
              <span className="text-muted-foreground">
                {data.arbitrator?.hearingDate
                  ? `Hearing ${fmtDay(data.arbitrator.hearingDate)}${data.arbitrator.hearingTime ? ` ${data.arbitrator.hearingTime}` : ""}`
                  : "Arbitrator not assigned yet"}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Opens once the application is confirmed.</span>
          )}
        </StatusCard>
      </div>

      {/* Deadlines + official sources */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="flex items-center gap-1 font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Upcoming deadlines
          </div>
          {upcoming.length ? (
            <ul className="mt-1 grid gap-1">
              {upcoming.map((u, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{u.label}</span>
                  <span className="shrink-0 font-medium">
                    {fmtDay(u.date)}
                    {u.days != null ? ` · ${u.days}d` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">None recorded.</p>
          )}
          {deadline.basis === "order" && stageIdx < 3 && (
            <p className="mt-1 text-muted-foreground">
              Counted from the order date — add the date you received it in the application.
            </p>
          )}
        </div>
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-muted-foreground">
            Official rules for {property.cad ?? "this county"}
          </div>
          <p className="mt-1 text-muted-foreground">
            {research.loading
              ? "Corvus AI is reading the Comptroller's and the appraisal district's pages…"
              : research.research
                ? `${research.research.statewide.length} statewide rules, ${research.research.countySpecific.length} county procedures, ${research.research.forms.length} forms — retrieved ${fmtDay(research.research.retrievedAt)}.`
                : "Couldn't read the official pages just now."}
          </p>
          <div className="mt-1 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setPopup("research")}
              className="text-accent hover:underline"
            >
              View rules & sources
            </button>
            <a
              href={PTAS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Comptroller PTAS ↗
            </a>
          </div>
        </div>
      </div>

      {!closed && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-card px-3 py-2 shadow-md">
          <span className="text-xs text-muted-foreground">Next step</span>
          <button
            type="button"
            onClick={() => setPopup(next.popup)}
            className="btn-accent py-1.5 text-xs"
          >
            {next.label}
          </button>
        </div>
      )}

      {/* ── Popups ───────────────────────────────────────────────────── */}
      <WorkflowPopup
        open={popup === "research"}
        onClose={() => setPopup(null)}
        title="Arbitration rules — official sources"
        wide
      >
        <CountyResearchPanel
          research={research.research}
          loading={research.loading}
          onRefresh={research.reload}
        />
      </WorkflowPopup>

      <WorkflowPopup
        open={popup === "eligibility"}
        onClose={() => setPopup(null)}
        title={`Eligibility: ${eligibilityLabel}`}
        description="Regular Binding Arbitration (RBA, Tax Code §41A) and Limited Binding Arbitration (LBA, §41A.015)."
      >
        <div className="grid gap-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Regular Binding Arbitration
            </div>
            <ul className="mt-1 grid gap-0.5">
              {eligibility.reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
              <li>
                • ARB value {currency(numbers.arbValue)} ·{" "}
                {cost.homestead
                  ? "residence homestead (any value)"
                  : "non-homestead (cap $5,000,000)"}
              </li>
              <li>
                • Owner&apos;s proposed value:{" "}
                {requestedValue != null
                  ? currency(requestedValue)
                  : "not on file — add it in the application"}
              </li>
              <li>
                • Deadline: {fmtDay(deadline.deadline)} (
                {deadline.basis === "received"
                  ? "60 days from the day you received the order"
                  : deadline.basis === "order"
                    ? "counted from the order date — enter the receipt date"
                    : "needs the order date"}
                )
              </li>
            </ul>
            {eligibility.missing.length > 0 && (
              <ul className="mt-1 grid gap-0.5 text-warning-foreground">
                {eligibility.missing.map((m, i) => (
                  <li key={i}>• Needed: {m}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5 text-xs">
            <span className="font-semibold">Requires verification:</span> whether the taxes you must
            pay before arbitration (the undisputed amount) are paid — check the official rules below
            and your Pay Taxes status.
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Limited Binding Arbitration
            </div>
            <p className="mt-1">
              Only for compelling the ARB or chief appraiser to follow a required procedure — not
              for value. Applies only if a procedural failure happened at your hearing.{" "}
              <a
                href={LBA_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Comptroller LBA page ↗
              </a>
            </p>
          </div>
          {eligibility.status !== "eligible" && (
            <p className="rounded-md border border-border p-2.5 text-xs">
              If arbitration isn&apos;t available, a district-court appeal (Tax Code ch. 42) or, for
              property over $1 million, SOAH may be — see Post ARB Options and the Court Appeal tab.
            </p>
          )}
          <button
            type="button"
            onClick={() => setPopup("research")}
            className="w-fit text-xs text-accent hover:underline"
          >
            Official eligibility rules for this county →
          </button>
        </div>
      </WorkflowPopup>

      <WorkflowPopup
        open={popup === "assessment"}
        onClose={() => setPopup(null)}
        title="AI Assessment"
        description="Decision support from your case and the figures below — not legal advice or a prediction."
      >
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <Fact k="ARB-determined value" v={currency(numbers.arbValue)} />
          <Fact
            k="Your proposed value"
            v={requestedValue != null ? currency(requestedValue) : "—"}
          />
          <Fact
            k="Potential additional savings"
            v={cost.savings != null ? `${currency(cost.savings)}/yr (est.)` : "—"}
          />
        </div>
        {requestedValue == null && (
          <label className="mt-2 grid gap-1 text-xs">
            <span className="text-muted-foreground">
              Your opinion of value (not on your Notice of Protest)
            </span>
            <input
              value={enteredValue}
              onChange={(e) => setEnteredValue(e.target.value)}
              inputMode="numeric"
              className={fieldClass}
              placeholder="e.g. 2,500,000"
            />
          </label>
        )}
        <div className="mt-3">
          {busy === "assess" && !data.assessment ? (
            <p className="text-sm text-muted-foreground">Assessing your case…</p>
          ) : data.assessment ? (
            <>
              <MarkdownLite text={data.assessment.text} className="text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Corvus AI · {fmtDay(data.assessment.at)}
              </p>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void assess()}
          disabled={busy === "assess"}
          className="btn-outline mt-3 py-1.5 text-xs disabled:opacity-60"
        >
          {busy === "assess" ? "Assessing…" : data.assessment ? "Assess again" : "Run assessment"}
        </button>
      </WorkflowPopup>

      <WorkflowPopup
        open={popup === "cost"}
        onClose={() => setPopup(null)}
        title="Cost & ROI"
        description="From the Comptroller's Arbitration Deposit and Arbitrator Fee Schedule (eff. Sept. 1, 2017)."
      >
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <Fact k="Required deposit" v={cost.deposit != null ? currency(cost.deposit) : "—"} />
          <Fact
            k="Arbitrator fee (from the deposit)"
            v={cost.arbitratorFee != null ? currency(cost.arbitratorFee) : "—"}
          />
          <Fact
            k="Comptroller administrative fee"
            v={`${currency(cost.retained)} kept in either case`}
          />
          <Fact k="Other expenses" v="None required; optional appraisal or agent fees are yours" />
          <Fact
            k="Potential additional tax savings"
            v={
              cost.savings != null
                ? `${currency(cost.savings)} / yr (est.)`
                : "Needs your opinion of value"
            }
          />
          <Fact k="Estimated ROI" v={cost.roi != null ? `${cost.roi}× the deposit` : "—"} />
          <Fact
            k="If the award is closer to YOUR value"
            v={
              cost.refundIfCloser != null
                ? `${currency(cost.refundIfCloser)} of the deposit refunded`
                : "—"
            }
          />
          <Fact
            k="If it's closer to the ARB value"
            v={
              cost.costIfNot != null
                ? `the ${currency(cost.costIfNot)} deposit pays the arbitrator`
                : "—"
            }
          />
          <Fact
            k="Filing deadline"
            v={`${fmtDay(deadline.deadline)}${deadline.daysRemaining != null ? ` (${deadline.daysRemaining} days)` : ""}`}
          />
          <Fact
            k="Basis"
            v={`${cost.homestead ? "Residence homestead" : "Not a residence homestead"}, ${currency(cost.value)}`}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Savings = (ARB value − your value) × {(cost.taxRate * 100).toFixed(2)}% effective tax
          rate, one year; an estimate, not a guarantee. Refund rule: Tax Code §41A.10.{" "}
          <a
            href={ARBITRATION_SCHEDULE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Fee schedule ↗
          </a>
        </p>
        <a
          href={PTAS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-accent mt-3 inline-flex items-center gap-1 py-1.5 text-xs"
        >
          Pay the deposit in the Comptroller&apos;s PTAS{" "}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </WorkflowPopup>

      <ApplicationPopup
        open={popup === "application"}
        onClose={() => setPopup(null)}
        property={property}
        protest={protest}
        data={data}
        requestedValue={requestedValue}
        hasArbOrder={!!facts.decisionNotice}
        research={research.research}
        busy={busy === "application"}
        onSave={(fields, ready) =>
          void run(
            "application",
            async () => {
              const received = fields.received || null;
              await save({
                orderReceivedDate: received,
                kind: fields.kind === "limited" ? "limited" : "regular",
                application: {
                  fields,
                  startedAt: data.application?.startedAt ?? new Date().toISOString(),
                  readyAt: ready ? new Date().toISOString() : (data.application?.readyAt ?? null),
                },
              });
              if (fields.requested && !requestedValue) setEnteredValue(fields.requested);
              toast.success(
                ready
                  ? "Ready for filing — file it in the Comptroller's PTAS next."
                  : "Progress saved.",
              );
              if (ready) setPopup("status");
            },
            "Could not save the application.",
          )
        }
        onDownload={(fields) =>
          void run(
            "appPdf",
            async () => {
              const bytes = await buildAttorneyPackagePdf({
                title: "Request for Binding Arbitration — prepared details",
                subtitle: `Prepared in CorvusPT ${new Date().toLocaleDateString()} for filing in the Comptroller's PTAS (Form AP-219). Not the filed form.`,
                sections: [
                  {
                    heading: "Application details",
                    lines: Object.entries(fields)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${APP_LABEL[k] ?? k}: ${v}`),
                  },
                ],
                evidence: [],
              });
              downloadPdf(
                bytes,
                `Arbitration-Application-${property.accountNumber ?? property.id}.pdf`,
              );
            },
            "Could not build the PDF.",
          )
        }
      />

      <StatusPopup
        open={popup === "status"}
        onClose={() => setPopup(null)}
        data={data}
        stage={stage}
        busy={busy}
        onOpenDoc={openDoc}
        onSubmit={(ref, file) =>
          void run(
            "submit",
            async () => {
              const doc = file ? await upload(file) : null;
              if (!ref && !doc)
                throw new Error(
                  "Add the PTAS request number or upload the submission confirmation.",
                );
              await save({
                submittedAt: new Date().toISOString(),
                submissionReference: ref || null,
                submissionDocumentId: doc?.id ?? null,
              });
              if (!protest.arbitrationFiledAt) {
                const at = await markArbitrationFiled(protest.id);
                onUpdate({ arbitrationFiledAt: at });
              }
              toast.success("Recorded — submitted to the Comptroller.");
            },
            "Could not record the submission.",
          )
        }
        onDeposit={(amount, method, file) =>
          void run(
            "deposit",
            async () => {
              const doc = file ? await upload(file, "Arbitration Deposit Receipt") : null;
              if (!doc)
                throw new Error(
                  "Upload the payment receipt or confirmation — the deposit isn't shown as paid without it.",
                );
              await save({
                depositPaidAt: new Date().toISOString(),
                depositAmount: amount,
                depositMethod: method || null,
                depositReceiptDocumentId: doc.id,
              });
              toast.success("Deposit payment recorded.");
            },
            "Could not record the deposit.",
          )
        }
        onConfirm={(num, file) =>
          void run(
            "confirm",
            async () => {
              const doc = file ? await upload(file) : null;
              if (!num && !doc)
                throw new Error(
                  "Add the arbitration number from the Comptroller or upload its confirmation.",
                );
              await save({
                confirmedAt: new Date().toISOString(),
                confirmationNumber: num || null,
                confirmationDocumentId: doc?.id ?? null,
              });
              void logCaseEvent(
                protest.id,
                "status_change",
                "Arbitration application confirmed by the Comptroller (owner recorded).",
                { number: num || null },
              );
              toast.success("Application confirmed — settlement and hearing steps are open.");
              setPopup(null);
            },
            "Could not record the confirmation.",
          )
        }
      />

      <WorkflowPopup
        open={popup === "evidence"}
        onClose={() => setPopup(null)}
        title="Existing ARB Evidence Packet"
        description="The evidence already prepared and used at your ARB hearing. Reusing it makes a separate arbitration copy — this packet stays unchanged."
      >
        <ul className="grid gap-1 text-sm">
          {evidenceDocuments.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {d.fileName}{" "}
                <span className="text-xs text-muted-foreground">
                  · {CATEGORY_LABEL[categorize(d)]}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void openDoc(d.id)}
                className="shrink-0 text-xs text-accent hover:underline"
              >
                View
              </button>
            </li>
          ))}
          {evidenceDocuments.length === 0 && (
            <li className="text-muted-foreground">No evidence on file from the ARB case.</li>
          )}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {!arbEvidence && (
            <button
              type="button"
              onClick={() => void reuseEvidence()}
              disabled={busy === "evidence"}
              className="btn-accent py-1.5 text-xs disabled:opacity-60"
            >
              Reuse Evidence for Arbitration
            </button>
          )}
          <FileButton
            label={busy === "addEvidence" ? "Uploading…" : "Add Additional Evidence"}
            onFile={(f) => void addEvidence(f)}
            disabled={busy === "addEvidence"}
          />
          {arbEvidence && (
            <button
              type="button"
              onClick={() => setPopup("prepare")}
              className="btn-outline py-1.5 text-xs"
            >
              Prepare Arbitration Evidence
            </button>
          )}
        </div>
      </WorkflowPopup>

      <PreparePopup
        open={popup === "prepare"}
        onClose={() => setPopup(null)}
        property={property}
        evidence={arbEvidence}
        busy={busy}
        onOpenDoc={openDoc}
        onRemove={(id) =>
          void run(
            "items",
            () => setItems((arbEvidence?.items ?? []).filter((i) => i.documentId !== id)),
            "Could not update.",
          )
        }
        onMove={(id, dir) =>
          void run(
            "items",
            () => {
              const items = [...(arbEvidence?.items ?? [])];
              const i = items.findIndex((x) => x.documentId === id);
              const j = i + dir;
              if (i < 0 || j < 0 || j >= items.length) return Promise.resolve();
              [items[i], items[j]] = [items[j], items[i]];
              return setItems(items);
            },
            "Could not update.",
          )
        }
        onCategory={(id, c) =>
          void run(
            "items",
            () =>
              setItems(
                (arbEvidence?.items ?? []).map((i) =>
                  i.documentId === id ? { ...i, category: c } : i,
                ),
              ),
            "Could not update.",
          )
        }
        onAdd={(f) => void addEvidence(f)}
        onReplace={(id, f) => void addEvidence(f, id)}
        onReview={() => void reviewEvidence()}
        onDownload={() => void downloadPacket()}
        onReuse={() => void reuseEvidence()}
      />

      <SettlementPopup
        open={popup === "settlement"}
        onClose={() => setPopup(null)}
        data={data}
        busy={busy}
        onWithdraw={() => setPopup("withdraw")}
        onSave={(patch) =>
          void run(
            "settlement",
            () =>
              save({
                settlement: {
                  ...(data.settlement ?? { status: "negotiating", offers: [] }),
                  ...patch,
                },
              }),
            "Could not save.",
          )
        }
        onOffer={(file, value, date) =>
          void run(
            "offer",
            async () => {
              let v = value;
              const doc = file ? await upload(file) : null;
              if (file && v == null) {
                const ex = await extractDecisionDocument(property, protest, file).catch(() => null);
                v = ex?.finalValue ?? null;
              }
              const s = data.settlement ?? { status: "negotiating" as const, offers: [] };
              await save({
                settlement: {
                  ...s,
                  status: "offer_received",
                  offers: [
                    ...s.offers,
                    {
                      id: newId(),
                      date,
                      value: v,
                      documentId: doc?.id ?? null,
                      decision: "pending",
                    },
                  ],
                },
              });
              toast.success(
                v != null ? `Offer of ${currency(v)} recorded.` : "Offer recorded — add its value.",
              );
            },
            "Could not record the offer.",
          )
        }
        onDecide={(id, decision) =>
          void run(
            "offer",
            async () => {
              const s = data.settlement!;
              const offers = s.offers.map((o) => (o.id === id ? { ...o, decision } : o));
              const accepted = offers.find((o) => o.decision === "accepted");
              await save({ settlement: { ...s, offers, status: accepted ? "settled" : s.status } });
              if (accepted?.value) {
                await recordFinalValueOnProperty(protest.id, property.id, accepted.value);
                onUpdate({
                  finalValue: accepted.value,
                  status: "resolved",
                  closedAt: new Date().toISOString(),
                });
                toast.success(
                  `Settled at ${currency(accepted.value)} — the case and property record are updated.`,
                );
              }
            },
            "Could not save the decision.",
          )
        }
      />

      <WithdrawPopup
        open={popup === "withdraw"}
        onClose={() => setPopup("settlement")}
        research={research.research}
        busy={busy === "withdraw"}
        onConfirm={(file) =>
          void run(
            "withdraw",
            async () => {
              const doc = file ? await upload(file) : null;
              if (!doc)
                throw new Error("Upload the filed withdrawal (Form 50-830) or its confirmation.");
              const s = data.settlement ?? { status: "negotiating" as const, offers: [] };
              await save({
                settlement: {
                  ...s,
                  withdrawnAt: new Date().toISOString(),
                  withdrawalDocumentId: doc.id,
                },
              });
              toast.success("Withdrawal recorded.");
              setPopup(null);
            },
            "Could not record the withdrawal.",
          )
        }
      />

      <ArbitratorPopup
        open={popup === "arbitrator"}
        onClose={() => setPopup(null)}
        data={data}
        busy={busy === "arbitrator"}
        onNotice={(file) =>
          run(
            "arbitrator",
            async () => {
              const doc = await upload(file, "Arbitration Hearing Notice");
              const r = await reviewDocument(doc.id).catch(() => null);
              const parsed: Record<string, string> = {};
              if (r?.explanation) {
                const { answer } = await askAboutDocument({
                  question:
                    "From this arbitration hearing notice summary, reply with exactly these lines (blank after the colon when not stated):\nARBITRATOR:\nHEARING DATE (YYYY-MM-DD):\nHEARING TIME:\nLOCATION:\nMEETING LINK:\nINSTRUCTIONS:",
                  context: r.explanation,
                });
                for (const line of answer.split(/\r?\n/)) {
                  const m = line.match(
                    /^(ARBITRATOR|HEARING DATE[^:]*|HEARING TIME|LOCATION|MEETING LINK|INSTRUCTIONS):\s*(.*)$/i,
                  );
                  if (m && m[2].trim()) parsed[m[1].toUpperCase().split(" (")[0]] = m[2].trim();
                }
              }
              return { docId: doc.id, parsed };
            },
            "Could not read the notice.",
          )
        }
        onSave={(a) =>
          void run(
            "arbitrator",
            async () => {
              await save({ arbitrator: { ...(data.arbitrator ?? {}), ...a } });
              toast.success("Saved.");
              setPopup(null);
            },
            "Could not save.",
          )
        }
      />

      <WorkflowPopup
        open={popup === "instructions"}
        onClose={() => setPopup(null)}
        title="Hearing instructions"
      >
        <p className="whitespace-pre-line text-sm">
          {data.arbitrator?.instructions ||
            "No instructions recorded — add them from your hearing notice."}
        </p>
      </WorkflowPopup>

      <HearingPopup
        open={popup === "hearing"}
        onClose={() => setPopup(null)}
        property={property}
        protest={protest}
        data={data}
        requestedValue={requestedValue}
        arbValue={numbers.arbValue}
        moduleFindings={facts.moduleFindings}
        caseContext={caseContext}
        onPacket={() => void downloadPacket()}
        onInstructions={() => setPopup("instructions")}
        onArbitrator={() => setPopup("arbitrator")}
      />

      <AwardPopup
        open={popup === "award"}
        onClose={() => setPopup(null)}
        property={property}
        protest={protest}
        requestedValue={requestedValue}
        arbValue={numbers.arbValue}
        deposit={cost.deposit}
        busy={busy === "award"}
        onSave={(value, date, file, ex) =>
          void run(
            "award",
            async () => {
              let docId: string | null = null;
              if (file) {
                const doc = await uploadDocument(userId, property.id, file, DECISION_DOCUMENT_TYPE);
                docId = doc.id;
                if (ex) await saveDecisionNotice(userId, protest.id, doc.id, ex);
              }
              const cmp = awardComparison(value, requestedValue, numbers.arbValue);
              const refund =
                numbers.arbValue != null && numbers.arbValue > value
                  ? Math.round((numbers.arbValue - value) * cost.taxRate)
                  : null;
              await save({
                award: { value, date, documentId: docId, at: new Date().toISOString() },
                post: {
                  ...(data.post ?? {}),
                  refund: refund
                    ? { expected: refund, status: "pending" }
                    : { expected: null, status: "not_applicable" },
                },
              });
              await recordFinalValueOnProperty(protest.id, property.id, value);
              onUpdate({
                finalValue: value,
                status: "resolved",
                closedAt: new Date().toISOString(),
              });
              toast.success(
                `Award of ${currency(value)} recorded${cmp.closerToOwner ? " — closer to your value, so the deposit should come back less $50" : ""}.`,
              );
              setPopup("final");
            },
            "Could not record the award.",
          )
        }
      />

      <FinalPopup
        open={popup === "final"}
        onClose={() => setPopup(null)}
        protest={protest}
        data={data}
        requestedValue={requestedValue}
        arbValue={numbers.arbValue}
        cost={cost}
        busy={busy}
        onOpenDoc={openDoc}
        onPost={(patch) =>
          void run(
            "post",
            () => save({ post: { ...(data.post ?? {}), ...patch } }),
            "Could not save.",
          )
        }
        onUpload={(file, kind) =>
          void run(
            "post",
            async () => {
              const doc = await upload(
                file,
                kind === "cad" ? "Updated CAD Record" : "Tax Statement",
              );
              await save({
                post: {
                  ...(data.post ?? {}),
                  ...(kind === "cad"
                    ? {
                        cadRecordDocumentId: doc.id,
                        rollCorrectedAt: data.post?.rollCorrectedAt ?? new Date().toISOString(),
                      }
                    : { taxStatementDocumentId: doc.id }),
                },
              });
              toast.success("Uploaded.");
            },
            "Could not upload.",
          )
        }
      />
    </div>
  );
}

const APP_LABEL: Record<string, string> = {
  kind: "Type",
  owner: "Owner name",
  ownerAddress: "Owner mailing address",
  ownerPhone: "Phone",
  ownerEmail: "Email",
  address: "Property address",
  cad: "Appraisal district",
  account: "CAD account number",
  taxYear: "Tax year",
  orderDate: "ARB order date",
  received: "Date ARB order received",
  arbValue: "ARB-determined value",
  requested: "Owner's opinion of value",
  agent: "Agent (if any)",
};

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-secondary/40 p-2.5">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function ApplicationPopup({
  open,
  onClose,
  property,
  protest,
  data,
  requestedValue,
  hasArbOrder,
  research,
  busy,
  onSave,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  property: PropertyRecord;
  protest: ProtestRecord;
  data: ArbitrationData;
  requestedValue: number | null;
  hasArbOrder: boolean;
  research: ReturnType<typeof useCountyResearch>["research"];
  busy: boolean;
  onSave: (fields: Record<string, string>, ready: boolean) => void;
  onDownload: (fields: Record<string, string>) => void;
}) {
  const saved = data.application?.fields ?? {};
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Record<string, string>>(() => ({
    kind: saved.kind ?? data.kind ?? "regular",
    owner: saved.owner ?? property.ownerName ?? "",
    ownerAddress: saved.ownerAddress ?? "",
    ownerPhone: saved.ownerPhone ?? "",
    ownerEmail: saved.ownerEmail ?? "",
    address: saved.address ?? property.address,
    cad: saved.cad ?? property.cad ?? "",
    account: saved.account ?? property.accountNumber ?? "",
    taxYear: saved.taxYear ?? String(protest.taxYear ?? property.taxYear ?? ""),
    orderDate: saved.orderDate ?? protest.arbDecisionDate ?? "",
    received: saved.received ?? data.orderReceivedDate ?? "",
    arbValue: saved.arbValue ?? (protest.finalValue != null ? String(protest.finalValue) : ""),
    requested: saved.requested ?? (requestedValue != null ? String(requestedValue) : ""),
    agent: saved.agent ?? "",
  }));
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const steps = ["Owner & property", "ARB order & values", "Documents checklist", "Review & file"];
  const missing = [
    "owner",
    "address",
    "cad",
    "account",
    "taxYear",
    "orderDate",
    "received",
    "arbValue",
    "requested",
  ].filter((k) => !f[k]);
  const input = (k: string, type = "text") => (
    <label key={k} className="grid gap-1 text-xs">
      <span className="text-muted-foreground">
        {APP_LABEL[k]}
        {!f[k] && ["agent", "ownerPhone", "ownerEmail", "ownerAddress"].indexOf(k) < 0 && (
          <span className="text-warning-foreground"> · missing</span>
        )}
      </span>
      <input
        type={type}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        className={fieldClass}
      />
    </label>
  );
  const checklist: [string, boolean, string][] = [
    [
      "ARB order (Order Determining Protest)",
      hasArbOrder,
      "Upload it on the Formal Hearing tab if it's not on file.",
    ],
    ["Your opinion of value", !!f.requested, "Stated in the request."],
    [
      "Deposit (paid in PTAS or by check with the paper form)",
      !!data.depositPaidAt,
      "Recorded after you pay.",
    ],
    [
      "Form 50-791 Appointment of Agent",
      !f.agent,
      f.agent ? "Needed because an agent is named." : "Only if an agent files for you.",
    ],
  ];
  const fromResearch = (research?.forms ?? []).map((x) => x);
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Arbitration Application"
      description="Pre-filled from your case. Complete what's missing here, then file it in the Comptroller's PTAS — CorvusPT doesn't file it."
      wide
    >
      <ol className="mb-3 flex flex-wrap gap-1 text-[11px]">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`rounded-full px-2 py-0.5 ${i === step ? "bg-accent text-accent-foreground font-semibold" : "bg-secondary text-muted-foreground"}`}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Type</span>
            <select
              value={f.kind}
              onChange={(e) => set("kind", e.target.value)}
              className={fieldClass}
            >
              <option value="regular">Regular Binding Arbitration (value) — Form AP-219</option>
              <option value="limited">Limited Binding Arbitration (procedure) — Form AP-241</option>
            </select>
          </label>
          {[
            "owner",
            "ownerAddress",
            "ownerPhone",
            "ownerEmail",
            "address",
            "cad",
            "account",
            "taxYear",
            "agent",
          ].map((k) => input(k))}
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {input("orderDate", "date")}
          {input("received", "date")}
          {input("arbValue")}
          {input("requested")}
          <p className="text-[11px] text-muted-foreground sm:col-span-2">
            The 60-day deadline runs from the date you received the order.
          </p>
        </div>
      )}
      {step === 2 && (
        <div className="grid gap-2 text-sm">
          <ul className="grid gap-1">
            {checklist.map(([l, ok, note]) => (
              <li key={l} className="flex gap-2">
                <span className={ok ? "text-success" : "text-warning-foreground"}>
                  {ok ? "✓" : "•"}
                </span>
                <span>
                  {l} <span className="text-xs text-muted-foreground">— {note}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="text-xs">
            <div className="font-semibold uppercase tracking-wide text-muted-foreground">
              Official forms
            </div>
            <ul className="mt-1 grid gap-0.5">
              {[
                ["Form AP-219, Request for Binding Arbitration", AP219_URL],
                ["Form AP-241, Request for Limited Binding Arbitration", AP241_URL],
                ["Form 50-791, Appointment of Agent for Binding Arbitration", AGENT_FORM_URL],
                ...fromResearch
                  .filter((x) => ![AP219_URL, AP241_URL, AGENT_FORM_URL].includes(x.url))
                  .map((x) => [x.name, x.url]),
              ].map(([n, u]) => (
                <li key={u}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {n} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="grid gap-2 text-sm">
          <ul className="grid gap-0.5 text-xs">
            {Object.entries(f)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted-foreground">{APP_LABEL[k]}:</span> {v}
                </li>
              ))}
          </ul>
          {missing.length > 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
              Still missing: {missing.map((k) => APP_LABEL[k]).join(", ")}.
            </p>
          )}
          <div className="rounded-md border border-border p-2.5 text-xs">
            <div className="font-semibold">In CorvusPT (done here)</div>
            <p className="text-muted-foreground">
              Details prepared, documents organized, deadline tracked.
            </p>
            <div className="mt-1.5 font-semibold">In the Comptroller&apos;s PTAS (external)</div>
            <p className="text-muted-foreground">
              File the request, attach the ARB order, pay the deposit. Then record each step here
              with its confirmation.
            </p>
            <a
              href={PTAS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-accent mt-2 inline-flex items-center gap-1 py-1 text-xs"
            >
              Open PTAS <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="btn-outline py-1.5 text-xs"
          >
            Back
          </button>
        )}
        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            className="btn-outline py-1.5 text-xs"
          >
            Next
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave(f, false)}
          disabled={busy}
          className="btn-outline py-1.5 text-xs disabled:opacity-60"
        >
          Save progress
        </button>
        <button type="button" onClick={() => onDownload(f)} className="btn-outline py-1.5 text-xs">
          Download details (PDF)
        </button>
        {step === 3 && (
          <button
            type="button"
            onClick={() => onSave(f, true)}
            disabled={busy || missing.length > 0}
            title={missing.length ? "Complete the missing details first" : undefined}
            className="btn-accent py-1.5 text-xs disabled:opacity-60"
          >
            Mark Ready for Filing
          </button>
        )}
      </div>
    </WorkflowPopup>
  );
}

function StatusPopup({
  open,
  onClose,
  data,
  stage,
  busy,
  onOpenDoc,
  onSubmit,
  onDeposit,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  data: ArbitrationData;
  stage: ReturnType<typeof applicationStage>;
  busy: string | null;
  onOpenDoc: (id: string | null | undefined) => void;
  onSubmit: (ref: string, file: File | null) => void;
  onDeposit: (amount: number | null, method: string, file: File | null) => void;
  onConfirm: (num: string, file: File | null) => void;
}) {
  const [ref, setRef] = useState(data.submissionReference ?? "");
  const [subFile, setSubFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(
    data.depositAmount != null ? String(data.depositAmount) : "",
  );
  const [method, setMethod] = useState(data.depositMethod ?? "");
  const [rcpt, setRcpt] = useState<File | null>(null);
  const [num, setNum] = useState(data.confirmationNumber ?? "");
  const [cFile, setCFile] = useState<File | null>(null);
  const idx = APP_STAGES.findIndex((s) => s.id === stage);
  const Row = ({
    done,
    title,
    children,
  }: {
    done: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <div
      className={`rounded-md border p-3 ${done ? "border-success/40 bg-success/5" : "border-border"}`}
    >
      <div className="text-sm font-semibold">
        {done ? "✓ " : ""}
        {title}
      </div>
      <div className="mt-1.5 grid gap-2 text-xs">{children}</div>
    </div>
  );
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Application status"
      description="Each external step is recorded here with its confirmation — nothing is marked filed, paid or confirmed without it."
    >
      <div className="grid gap-2">
        <Row done={idx >= 3} title="1. Submitted to the Comptroller (PTAS)">
          {idx >= 3 ? (
            <span>
              {data.submissionReference ? `Request ${data.submissionReference}` : "Submitted"}
              {data.submissionDocumentId && (
                <button
                  type="button"
                  onClick={() => onOpenDoc(data.submissionDocumentId)}
                  className="ml-2 text-accent hover:underline"
                >
                  View confirmation
                </button>
              )}
            </span>
          ) : (
            <>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="PTAS request / confirmation number"
                className={fieldClass}
              />
              <FileButton
                label={subFile ? subFile.name : "Upload filing confirmation"}
                onFile={setSubFile}
              />
              <button
                type="button"
                onClick={() => onSubmit(ref.trim(), subFile)}
                disabled={busy === "submit" || idx < 2}
                title={idx < 2 ? "Finish the application first" : undefined}
                className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
              >
                Record submission
              </button>
            </>
          )}
        </Row>
        <Row done={idx >= 5} title="2. Deposit paid">
          {idx >= 5 ? (
            <span>
              {data.depositAmount != null ? currency(data.depositAmount) : "Paid"}{" "}
              {data.depositMethod ? `· ${data.depositMethod}` : ""}
              <button
                type="button"
                onClick={() => onOpenDoc(data.depositReceiptDocumentId)}
                className="ml-2 text-accent hover:underline"
              >
                View receipt
              </button>
            </span>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount"
                  className={fieldClass}
                />
                <input
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  placeholder="Method (card, ACH, check)"
                  className={fieldClass}
                />
              </div>
              <FileButton label={rcpt ? rcpt.name : "Upload payment receipt"} onFile={setRcpt} />
              <button
                type="button"
                onClick={() => onDeposit(parseMoney(amount), method.trim(), rcpt)}
                disabled={busy === "deposit" || idx < 3}
                className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
              >
                Record deposit payment
              </button>
              <a
                href={PTAS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Payment page (PTAS) ↗
              </a>
            </>
          )}
        </Row>
        <Row done={idx >= 6} title="3. Application confirmed">
          {idx >= 6 ? (
            <span>
              {data.confirmationNumber ? `Arbitration ${data.confirmationNumber}` : "Confirmed"}
              {data.confirmationDocumentId && (
                <button
                  type="button"
                  onClick={() => onOpenDoc(data.confirmationDocumentId)}
                  className="ml-2 text-accent hover:underline"
                >
                  View
                </button>
              )}
            </span>
          ) : (
            <>
              <input
                value={num}
                onChange={(e) => setNum(e.target.value)}
                placeholder="Arbitration number from the Comptroller"
                className={fieldClass}
              />
              <FileButton label={cFile ? cFile.name : "Upload confirmation"} onFile={setCFile} />
              <button
                type="button"
                onClick={() => onConfirm(num.trim(), cFile)}
                disabled={busy === "confirm" || idx < 5}
                className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
              >
                Record confirmation
              </button>
            </>
          )}
        </Row>
      </div>
    </WorkflowPopup>
  );
}

function PreparePopup({
  open,
  onClose,
  property,
  evidence,
  busy,
  onOpenDoc,
  onRemove,
  onMove,
  onCategory,
  onAdd,
  onReplace,
  onReview,
  onDownload,
  onReuse,
}: {
  open: boolean;
  onClose: () => void;
  property: PropertyRecord;
  evidence: ArbitrationData["evidence"];
  busy: string | null;
  onOpenDoc: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onCategory: (id: string, c: EvidenceCategory) => void;
  onAdd: (f: File) => void;
  onReplace: (id: string, f: File) => void;
  onReview: () => void;
  onDownload: () => void;
  onReuse: () => void;
}) {
  const items = evidence?.items ?? [];
  const have = new Set(items.map((i) => i.category));
  const recommended = recommendedCategories(property);
  const review = evidence?.review;
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Prepare Arbitration Evidence"
      description="Your arbitration copy — add, remove, replace and order documents. The original ARB packet isn't changed."
      wide
    >
      {!evidence ? (
        <button type="button" onClick={onReuse} className="btn-accent py-1.5 text-xs">
          Reuse Evidence for Arbitration
        </button>
      ) : (
        <>
          <div className="grid gap-1.5 text-xs">
            <div className="font-semibold uppercase tracking-wide text-muted-foreground">
              Checklist
            </div>
            <ul className="grid gap-0.5 sm:grid-cols-2">
              {(Object.keys(CATEGORY_LABEL) as EvidenceCategory[])
                .filter((c) => c !== "other")
                .map((c) => {
                  const its = items.filter((i) => i.category === c);
                  const status = its.some((i) => i.source === "added")
                    ? "Uploaded"
                    : its.length
                      ? "Reused"
                      : recommended.includes(c)
                        ? "Recommended — missing"
                        : "Optional";
                  return (
                    <li
                      key={c}
                      className={
                        status.startsWith("Recommended")
                          ? "text-warning-foreground"
                          : its.length
                            ? "text-success"
                            : "text-muted-foreground"
                      }
                    >
                      {its.length ? "✓" : "•"} {CATEGORY_LABEL[c]} — {status}
                    </li>
                  );
                })}
            </ul>
          </div>
          <ol className="mt-3 grid gap-1 text-sm">
            {items.map((i, n) => (
              <li
                key={i.documentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1"
              >
                <span className="min-w-0 truncate">
                  {n + 1}. {i.fileName}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    ({i.source === "reused" ? "reused from ARB" : "added"})
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={i.category}
                    onChange={(e) => onCategory(i.documentId, e.target.value as EvidenceCategory)}
                    className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                  >
                    {(Object.keys(CATEGORY_LABEL) as EvidenceCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onOpenDoc(i.documentId)}
                    className="text-accent hover:underline"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(i.documentId, -1)}
                    aria-label="Move up"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(i.documentId, 1)}
                    aria-label="Move down"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ↓
                  </button>
                  <label className="cursor-pointer text-accent hover:underline">
                    Replace
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) onReplace(i.documentId, f);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onRemove(i.documentId)}
                    className="text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
            {items.length === 0 && (
              <li className="text-muted-foreground">The arbitration copy is empty.</li>
            )}
          </ol>
          {review && (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["Still relevant", review.relevant],
                  ["Additional useful evidence", review.useful],
                  ["Gaps", review.gaps],
                  ["Required by arbitration procedure", review.required],
                ] as [string, string[]][]
              )
                .filter(([, l]) => l.length)
                .map(([h, l]) => (
                  <div key={h}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {h}
                    </div>
                    <ul className="mt-0.5 grid gap-0.5">
                      {l.map((x, k) => (
                        <li key={k}>• {x}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <FileButton
              label={busy === "addEvidence" ? "Uploading…" : "Upload additional evidence"}
              onFile={onAdd}
              disabled={busy === "addEvidence"}
            />
            <button
              type="button"
              onClick={onReview}
              disabled={busy === "reviewEvidence"}
              className="btn-outline py-1.5 text-xs disabled:opacity-60"
            >
              {busy === "reviewEvidence"
                ? "Reviewing…"
                : review
                  ? "AI review again"
                  : "AI review of the evidence"}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={busy === "packet" || items.length === 0}
              className="btn-accent py-1.5 text-xs disabled:opacity-60"
            >
              {busy === "packet" ? "Building…" : "Download arbitration evidence packet (PDF)"}
            </button>
          </div>
        </>
      )}
    </WorkflowPopup>
  );
}

function SettlementPopup({
  open,
  onClose,
  data,
  busy,
  onWithdraw,
  onSave,
  onOffer,
  onDecide,
}: {
  open: boolean;
  onClose: () => void;
  data: ArbitrationData;
  busy: string | null;
  onWithdraw: () => void;
  onSave: (patch: Partial<NonNullable<ArbitrationData["settlement"]>>) => void;
  onOffer: (file: File | null, value: number | null, date: string) => void;
  onDecide: (id: string, d: "accepted" | "rejected") => void;
}) {
  const s = data.settlement;
  const [start, setStart] = useState(s?.startDate ?? "");
  const [end, setEnd] = useState(s?.endDate ?? "");
  const [val, setVal] = useState("");
  const daysLeft = s?.endDate
    ? Math.ceil((new Date(`${s.endDate}T12:00:00`).getTime() - Date.now()) / 86_400_000)
    : null;
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Settlement period"
      description="After the Comptroller processes the request the appraisal district may offer to settle before an arbitrator is assigned. Enter the dates from your notice."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Start</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">End</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Days remaining</span>
          <span className="font-medium">
            {daysLeft != null ? (daysLeft < 0 ? "Ended" : daysLeft) : "—"}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Status:</span>
        <select
          value={s?.status ?? "negotiating"}
          onChange={(e) =>
            onSave({
              status: e.target.value as NonNullable<ArbitrationData["settlement"]>["status"],
            })
          }
          className="rounded border border-input bg-background px-1 py-0.5"
        >
          <option value="negotiating">Negotiating</option>
          <option value="offer_received">Offer received</option>
          <option value="settled">Settled</option>
          <option value="not_settled">Not settled — going to hearing</option>
        </select>
        <button
          type="button"
          onClick={() => onSave({ startDate: start || null, endDate: end || null })}
          disabled={busy === "settlement"}
          className="btn-outline py-1 text-xs"
        >
          Save dates
        </button>
      </div>
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Settlement offers
        </div>
        <ul className="mt-1 grid gap-1 text-sm">
          {(s?.offers ?? []).map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {fmtDay(o.date)} · {o.value != null ? currency(o.value) : "value not read"} ·{" "}
                {o.decision}
              </span>
              {o.decision === "pending" && (
                <span className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onDecide(o.id, "accepted")}
                    className="text-success hover:underline"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(o.id, "rejected")}
                    className="text-destructive hover:underline"
                  >
                    Decline
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="Offer value (or upload)"
            className={fieldClass}
          />
          <FileButton
            label={busy === "offer" ? "Reading…" : "Upload settlement offer"}
            onFile={(f) => onOffer(f, parseMoney(val), new Date().toISOString().slice(0, 10))}
            disabled={busy === "offer"}
          />
          {val && (
            <button
              type="button"
              onClick={() => onOffer(null, parseMoney(val), new Date().toISOString().slice(0, 10))}
              className="btn-outline py-1 text-xs"
            >
              Record offer
            </button>
          )}
        </div>
      </div>
      {!s?.withdrawnAt ? (
        <button
          type="button"
          onClick={onWithdraw}
          className="mt-4 text-xs text-destructive hover:underline"
        >
          Withdraw the arbitration request…
        </button>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Withdrawn {fmtDay(s.withdrawnAt)}.</p>
      )}
    </WorkflowPopup>
  );
}

function WithdrawPopup({
  open,
  onClose,
  research,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  research: ReturnType<typeof useCountyResearch>["research"];
  busy: boolean;
  onConfirm: (file: File | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const rules = research
    ? [
        ...research.statewide,
        ...research.countySpecific,
        ...research.fees.map((x) => ({ text: `${x.item}: ${x.amount}`, sourceUrl: x.sourceUrl })),
      ].filter((x) => /withdraw|refund|settle/i.test(x.text))
    : [];
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Withdraw the arbitration request"
      description="Read the withdrawal and deposit-refund rules before you withdraw. Withdrawal is filed with the Comptroller (Form 50-830)."
    >
      <ul className="grid gap-1 text-sm">
        {rules.length ? (
          rules.map((r, i) => (
            <li key={i}>
              • {r.text}
              {r.sourceUrl && (
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-accent"
                >
                  ↗
                </a>
              )}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">
            The official withdrawal rules couldn&apos;t be read just now — check the
            Comptroller&apos;s arbitration page before withdrawing.
          </li>
        )}
      </ul>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <a
          href={WITHDRAWAL_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Form 50-830, Notice of Arbitration Withdrawal ↗
        </a>
        <a
          href={ARBITRATION_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Comptroller arbitration page ↗
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FileButton
          label={file ? file.name : "Upload filed withdrawal / confirmation"}
          onFile={setFile}
        />
        <button
          type="button"
          onClick={() => onConfirm(file)}
          disabled={busy || !file}
          className="btn-outline py-1.5 text-xs text-destructive disabled:opacity-60"
        >
          Record withdrawal
        </button>
      </div>
    </WorkflowPopup>
  );
}

function ArbitratorPopup({
  open,
  onClose,
  data,
  busy,
  onNotice,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  data: ArbitrationData;
  busy: boolean;
  onNotice: (f: File) => Promise<{ docId: string; parsed: Record<string, string> } | undefined>;
  onSave: (a: NonNullable<ArbitrationData["arbitrator"]>) => void;
}) {
  const a = data.arbitrator ?? {};
  const [v, setV] = useState({
    name: a.name ?? "",
    email: a.email ?? "",
    phone: a.phone ?? "",
    appointedAt: a.appointedAt ?? "",
    hearingDate: a.hearingDate ?? "",
    hearingTime: a.hearingTime ?? "",
    location: a.location ?? "",
    meetingLink: a.meetingLink ?? "",
    instructions: a.instructions ?? "",
    noticeDocumentId: a.noticeDocumentId ?? "",
  });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const labels: [keyof typeof v, string, string?][] = [
    ["name", "Arbitrator"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["appointedAt", "Appointed on", "date"],
    ["hearingDate", "Hearing date", "date"],
    ["hearingTime", "Hearing time"],
    ["location", "Location"],
    ["meetingLink", "Virtual meeting link"],
  ];
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Arbitrator & hearing"
      description="Upload the hearing notice and Corvus AI fills in what it says — check it before saving."
    >
      <FileButton
        label={busy ? "Reading notice…" : "Upload Hearing Notice"}
        disabled={busy}
        onFile={async (f) => {
          const r = await onNotice(f);
          if (!r) return;
          const p = r.parsed;
          setV((s) => ({
            ...s,
            noticeDocumentId: r.docId,
            name: p.ARBITRATOR ?? s.name,
            hearingDate: p["HEARING DATE"]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? s.hearingDate,
            hearingTime: p["HEARING TIME"] ?? s.hearingTime,
            location: p.LOCATION ?? s.location,
            meetingLink: /^https:\/\//.test(p["MEETING LINK"] ?? "")
              ? p["MEETING LINK"]
              : s.meetingLink,
            instructions: p.INSTRUCTIONS ?? s.instructions,
          }));
          toast.success("Notice read — check the details below.");
        }}
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {labels.map(([k, l, t]) => (
          <label key={k} className="grid gap-1 text-xs">
            <span className="text-muted-foreground">{l}</span>
            <input
              type={t ?? "text"}
              value={v[k]}
              onChange={(e) => set(k, e.target.value)}
              className={fieldClass}
            />
          </label>
        ))}
        <label className="grid gap-1 text-xs sm:col-span-2">
          <span className="text-muted-foreground">Instructions received</span>
          <textarea
            rows={3}
            value={v.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() =>
          onSave({
            ...v,
            appointedAt: v.appointedAt || null,
            hearingDate: v.hearingDate || null,
            noticeDocumentId: v.noticeDocumentId || null,
          })
        }
        disabled={busy}
        className="btn-accent mt-3 py-1.5 text-xs disabled:opacity-60"
      >
        Save
      </button>
    </WorkflowPopup>
  );
}

function HearingPopup({
  open,
  onClose,
  property,
  protest,
  data,
  requestedValue,
  arbValue,
  moduleFindings,
  caseContext,
  onPacket,
  onInstructions,
  onArbitrator,
}: {
  open: boolean;
  onClose: () => void;
  property: PropertyRecord;
  protest: ProtestRecord;
  data: ArbitrationData;
  requestedValue: number | null;
  arbValue: number | null;
  moduleFindings: { title: string; finding: string }[];
  caseContext: () => string;
  onPacket: () => void;
  onInstructions: () => void;
  onArbitrator: () => void;
}) {
  const [qs, setQs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const a = data.arbitrator;
  async function questions() {
    setLoading(true);
    try {
      const { answer } = await askAboutDocument({
        question:
          "Write the 8 questions an arbitrator is most likely to ask THIS owner at a binding arbitration for this specific property and case. Reply with a numbered list, one question per line, and no other text.",
        context: caseContext(),
      });
      setQs(parseBulletList(answer).slice(0, 8));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not write the questions."));
    } finally {
      setLoading(false);
    }
  }
  function addToCalendar() {
    if (!a?.hearingDate) return;
    const ics = hearingIcs(
      `Arbitration hearing — ${property.address}`,
      a.hearingDate,
      a.hearingTime ?? null,
      a.location ?? a.meetingLink ?? null,
    );
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "arbitration-hearing.ics";
    el.click();
    URL.revokeObjectURL(url);
  }
  return (
    <WorkflowPopup open={open} onClose={onClose} title="Prepare for Arbitration Hearing" wide>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <Fact
          k="Hearing"
          v={a?.hearingDate ? `${fmtDay(a.hearingDate)} ${a.hearingTime ?? ""}` : "Not scheduled"}
        />
        <Fact k="Where" v={a?.location || (a?.meetingLink ? "Virtual" : "—")} />
        <Fact k="Arbitrator" v={a?.name || "—"} />
        <Fact k="Your value" v={requestedValue != null ? currency(requestedValue) : "—"} />
        <Fact k="ARB / appraisal district value" v={currency(arbValue)} />
        <Fact
          k="Difference"
          v={requestedValue != null && arbValue != null ? currency(arbValue - requestedValue) : "—"}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <button type="button" onClick={onPacket} className="text-accent hover:underline">
          Final evidence packet (PDF)
        </button>
        {a?.hearingDate && (
          <button type="button" onClick={addToCalendar} className="text-accent hover:underline">
            Add Hearing Date to Calendar
          </button>
        )}
        <button type="button" onClick={onInstructions} className="text-accent hover:underline">
          View Hearing Instructions
        </button>
        {a?.meetingLink && (
          <a
            href={a.meetingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Join meeting ↗
          </a>
        )}
        <button type="button" onClick={onArbitrator} className="text-accent hover:underline">
          Edit hearing details
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your valuation summary
          </div>
          <ul className="mt-1 grid gap-0.5 text-xs">
            {moduleFindings.slice(0, 6).map((m, i) => (
              <li key={i}>
                • <span className="font-medium">{m.title}:</span> {m.finding}
              </li>
            ))}
            {moduleFindings.length === 0 && (
              <li className="text-muted-foreground">
                Run the AI Report modules for a valuation summary.
              </li>
            )}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Key property facts
          </div>
          <ul className="mt-1 grid gap-0.5 text-xs">
            <li>• {property.address}</li>
            <li>
              • {property.propertyType ?? "Property type —"} · {property.cad ?? ""}{" "}
              {property.accountNumber ?? ""}
            </li>
            <li>
              • Tax year {protest.taxYear ?? property.taxYear ?? "—"} · ARB decision{" "}
              {protest.arbDecision ?? "—"}
            </li>
            <li>
              • Appraisal district&apos;s evidence:{" "}
              {protest.cadEvidenceReceivedAt
                ? `received ${fmtDay(protest.cadEvidenceReceivedAt)} — in your Documents`
                : "not received"}
            </li>
          </ul>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Hearing checklist
        </div>
        <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
          {[
            ["Evidence packet ready", !!data.evidence?.items.length],
            ["Hearing date & place confirmed", !!a?.hearingDate],
            ["Instructions read", !!a?.instructions],
            ["Deposit paid", !!data.depositPaidAt],
            ["Your value and how you reached it, in one sentence", !!requestedValue],
            ["The district's evidence reviewed", !!protest.cadEvidenceReceivedAt],
          ].map(([l, ok]) => (
            <li key={String(l)} className={ok ? "text-success" : "text-muted-foreground"}>
              {ok ? "✓" : "•"} {l}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void questions()}
          disabled={loading}
          className="btn-outline py-1.5 text-xs disabled:opacity-60"
        >
          {loading
            ? "Writing…"
            : qs.length
              ? "New practice questions"
              : "Questions the arbitrator may ask"}
        </button>
        {qs.length > 0 && (
          <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm">
            {qs.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        )}
      </div>
    </WorkflowPopup>
  );
}

function AwardPopup({
  open,
  onClose,
  property,
  protest,
  requestedValue,
  arbValue,
  deposit,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  property: PropertyRecord;
  protest: ProtestRecord;
  requestedValue: number | null;
  arbValue: number | null;
  deposit: number | null;
  busy: boolean;
  onSave: (
    value: number,
    date: string | null,
    file: File | null,
    ex: Awaited<ReturnType<typeof extractDecisionDocument>> | null,
  ) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [ex, setEx] = useState<Awaited<ReturnType<typeof extractDecisionDocument>> | null>(null);
  const [value, setValue] = useState("");
  const [reading, setReading] = useState(false);
  const v = parseMoney(value);
  const cmp = v != null ? awardComparison(v, requestedValue, arbValue) : null;
  return (
    <WorkflowPopup
      open={open}
      onClose={onClose}
      title="Upload Arbitration Award"
      description="Corvus AI reads the award; check the value before recording it."
    >
      <FileButton
        label={reading ? "Reading…" : file ? file.name : "Upload the award"}
        disabled={reading}
        onFile={async (f) => {
          setFile(f);
          setReading(true);
          try {
            const e = await extractDecisionDocument(property, protest, f);
            setEx(e);
            if (e.finalValue) setValue(String(e.finalValue));
          } catch {
            toast.info("Couldn't read the award — enter the value.");
          } finally {
            setReading(false);
          }
        }}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Arbitrator's final value"
        className={`${fieldClass} mt-2`}
      />
      {v != null && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Fact k="Arbitrator's value" v={currency(v)} />
          <Fact
            k="Your proposed value"
            v={requestedValue != null ? currency(requestedValue) : "—"}
          />
          <Fact k="ARB value" v={currency(arbValue)} />
          <Fact
            k="Closer to your value?"
            v={cmp?.closerToOwner == null ? "Needs your value" : cmp.closerToOwner ? "Yes" : "No"}
          />
          <Fact
            k="Deposit"
            v={
              cmp?.closerToOwner
                ? `${deposit != null ? currency(deposit - 50) : "Deposit"} refunded (less $50)`
                : cmp?.closerToOwner === false
                  ? "Pays the arbitrator — no refund"
                  : "—"
            }
          />
          <Fact
            k="Value reduction vs the ARB"
            v={cmp?.reductionFromArb != null ? `${currency(cmp.reductionFromArb)} lower` : "—"}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => v && onSave(v, ex?.decisionDate ?? null, file, ex)}
        disabled={busy || !v}
        className="btn-accent mt-3 py-1.5 text-xs disabled:opacity-60"
      >
        Record the award
      </button>
    </WorkflowPopup>
  );
}

function FinalPopup({
  open,
  onClose,
  protest,
  data,
  requestedValue,
  arbValue,
  cost,
  busy,
  onOpenDoc,
  onPost,
  onUpload,
}: {
  open: boolean;
  onClose: () => void;
  protest: ProtestRecord;
  data: ArbitrationData;
  requestedValue: number | null;
  arbValue: number | null;
  cost: ReturnType<typeof arbitrationCost>;
  busy: string | null;
  onOpenDoc: (id: string | null | undefined) => void;
  onPost: (patch: Partial<NonNullable<ArbitrationData["post"]>>) => void;
  onUpload: (f: File, kind: "cad" | "tax") => void;
}) {
  const [amt, setAmt] = useState("");
  const award = data.award?.value ?? protest.finalValue ?? null;
  const p = data.post ?? {};
  const savings =
    award != null && arbValue != null
      ? Math.max(0, Math.round((arbValue - award) * cost.taxRate))
      : null;
  return (
    <WorkflowPopup open={open} onClose={onClose} title="Final case summary & tracking" wide>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <Fact k="Final value" v={currency(award)} />
        <Fact k="ARB value" v={currency(arbValue)} />
        <Fact k="Your value" v={requestedValue != null ? currency(requestedValue) : "—"} />
        <Fact k="Tax saved vs ARB (est.)" v={savings != null ? `${currency(savings)}/yr` : "—"} />
      </div>
      <ul className="mt-3 grid gap-2 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {p.rollCorrectedAt ? "✓" : "•"} Appraisal roll corrected
            {p.rollCorrectedAt ? ` (${fmtDay(p.rollCorrectedAt)})` : ""}
          </span>
          <span className="flex gap-2 text-xs">
            {!p.rollCorrectedAt && (
              <button
                type="button"
                onClick={() => onPost({ rollCorrectedAt: new Date().toISOString() })}
                className="text-accent hover:underline"
              >
                Mark corrected
              </button>
            )}
            <label className="cursor-pointer text-accent hover:underline">
              Upload updated CAD record
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload(f, "cad");
                }}
              />
            </label>
            {p.cadRecordDocumentId && (
              <button
                type="button"
                onClick={() => onOpenDoc(p.cadRecordDocumentId)}
                className="text-accent hover:underline"
              >
                View
              </button>
            )}
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>{p.taxAdjustedAt ? "✓" : "•"} Tax bill adjusted to the final value</span>
          <span className="flex gap-2 text-xs">
            {!p.taxAdjustedAt && (
              <button
                type="button"
                onClick={() => onPost({ taxAdjustedAt: new Date().toISOString() })}
                className="text-accent hover:underline"
              >
                Mark adjusted
              </button>
            )}
            <label className="cursor-pointer text-accent hover:underline">
              Upload tax statement
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload(f, "tax");
                }}
              />
            </label>
            {p.taxStatementDocumentId && (
              <button
                type="button"
                onClick={() => onOpenDoc(p.taxStatementDocumentId)}
                className="text-accent hover:underline"
              >
                View
              </button>
            )}
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {p.refund?.status === "received" ? "✓" : "•"} Refund:{" "}
            {p.refund?.status === "received"
              ? `received ${p.refund.amount != null ? currency(p.refund.amount) : ""}`
              : p.refund?.status === "pending"
                ? `about ${currency(p.refund.expected)} expected if taxes were paid at the ARB value (est.)`
                : "none expected"}
          </span>
          {p.refund?.status === "pending" && (
            <span className="flex items-center gap-2 text-xs">
              <input
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                placeholder="Amount"
                className="rounded border border-input bg-background px-1.5 py-0.5"
              />
              <button
                type="button"
                disabled={busy === "post"}
                onClick={() =>
                  onPost({
                    refund: {
                      ...p.refund!,
                      status: "received",
                      amount: parseMoney(amt),
                      receivedAt: new Date().toISOString(),
                    },
                  })
                }
                className="text-accent hover:underline"
              >
                Record received
              </button>
            </span>
          )}
        </li>
      </ul>
      {data.award?.documentId && (
        <button
          type="button"
          onClick={() => onOpenDoc(data.award?.documentId)}
          className="mt-3 text-xs text-accent hover:underline"
        >
          View / download the award
        </button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        The property record carries the final value and is back in tax monitoring for next year.{" "}
        <Link to="/dashboard/properties" className="text-accent hover:underline">
          My properties
        </Link>
      </p>
    </WorkflowPopup>
  );
}
