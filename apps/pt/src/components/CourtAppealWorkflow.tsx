import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  Check,
  FileText,
  Gavel,
  Landmark,
  Scale,
  Sparkles,
} from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import type { ProtestCase } from "@/lib/protest-case";
import { recordFinalValueOnProperty, saveCourtAppeal } from "@/lib/protest-case";
import { logCaseEvent } from "@/lib/case-audit";
import {
  getDocumentById,
  getDocumentUrl,
  uploadDocument,
  type DocumentRecord,
} from "@/lib/documents";
import { reviewDocument } from "@/lib/document-review";
import { askAboutDocument } from "@/lib/document-ai";
import { downloadPdf } from "@/lib/protest-documents";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";
import { getEffectiveTaxRate } from "@/lib/texas-tax-rates";
import { useCaseFacts } from "@/hooks/use-case-facts";
import { buildCaseContext } from "@/lib/case-context";
import { useCountyResearch } from "@/lib/county-research";
import { CountyResearchPanel } from "@/components/CountyResearchPanel";
import {
  arbitrationImpact,
  buildArbitrationNumbers,
  parseBulletList,
  parseMoney,
  parseSections,
} from "@/lib/arbitration";
import {
  COURT_DISCLAIMER,
  UPDATE_TYPE_LABEL,
  courtMissing,
  courtNextAction,
  courtStages,
  courtTimeline,
  courtUpcoming,
  newUpdateId,
  reviewCourtAppeal,
  type CourtAiReview,
  type CourtAppealData,
  type CourtUpdateType,
} from "@/lib/court-appeal";
import { buildAttorneyPackagePdf } from "@/lib/court-appeal-package";
import { extractDecisionDocument } from "@/lib/decision-notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COURT_DOC_TYPE = "Court Appeal Document";
const ATTORNEY_PACKAGE_TYPE = "Attorney Case Package";
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

type Popup =
  | "review"
  | "research"
  | "ai"
  | "package"
  | "attorney"
  | "petition"
  | "confirmation"
  | "update"
  | "resolve"
  | "timeline"
  | null;

const NO_LEGAL =
  "You are helping organize a case for attorney review. Do NOT give legal advice, legal conclusions, or any prediction about who will win.";

// The court-appeal leg of a case — a continuation of the SAME protest: the
// property, evidence, comparables, arguments and hearing history already on
// file are reused, never asked for again. One compact page (status, deadlines,
// next action); every form, report and checklist opens in a popup. CorvusPT
// organizes — deadline, AI review, attorney package, timeline, document
// summaries; it does not file the petition or give legal advice, and only
// shows the petition as filed once the owner confirms it with proof.
export function CourtAppealWorkflow({
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
  const data: CourtAppealData = protest.courtAppeal ?? {};
  const facts = useCaseFacts(protest, property);
  const research = useCountyResearch(property.cad, "court_appeal");
  const [popup, setPopup] = useState<Popup>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [enteredValue, setEnteredValue] = useState("");

  const requestedValue = facts.requestedValue ?? parseMoney(enteredValue);
  const review = useMemo(
    () => reviewCourtAppeal(property, protest, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [property, protest, protest.courtAppeal],
  );
  const numbers = buildArbitrationNumbers(property, protest, requestedValue);
  const next = courtNextAction(protest, data);
  const stages = courtStages(protest, data);
  const closed = protest.status === "resolved";
  const filed = !!data.petitionFiledAt;
  const timeline = courtTimeline(data);
  const missing = courtMissing(protest, data, {
    arbOrderDocument: !!facts.decisionNotice,
    requestedValue: requestedValue != null,
  });
  const upcoming = courtUpcoming(review, data);

  async function save(patch: Partial<CourtAppealData>) {
    const merged: CourtAppealData = { ...data, ...patch };
    await saveCourtAppeal(protest.id, merged);
    onUpdate({ courtAppeal: merged });
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
      deadline: review.deadline,
      daysRemaining: review.daysRemaining,
    });

  // ── AI case review (saved) ───────────────────────────────────────────
  async function runAiReview() {
    await run(
      "ai",
      async () => {
        const H = [
          "CASE SUMMARY",
          "ISSUES FROM THE ARB DECISION",
          "EVIDENCE GAPS",
          "VALUATION QUESTIONS",
          "PROCEDURAL MATTERS",
        ] as const;
        const { answer } = await askAboutDocument({
          question:
            `${NO_LEGAL} Review this protest and hearing case for an attorney. Reply in exactly this format and nothing else:\n` +
            "CASE SUMMARY:\n- (4-6 short bullets: property, ARB result vs requested value, main protest arguments, evidence submitted, key comparables/market data, hearing history)\n" +
            "ISSUES FROM THE ARB DECISION:\n- (up to 4 bullets: points in the ARB decision/order that look unanswered or worth a closer look)\n" +
            "EVIDENCE GAPS:\n- (up to 4 bullets: evidence that may be missing or worth adding)\n" +
            "VALUATION QUESTIONS:\n- (up to 4 bullets: valuation questions to discuss)\n" +
            "PROCEDURAL MATTERS:\n- (up to 3 bullets: procedural points about the hearing or order to ask an attorney about)\n" +
            "Phrase everything as things to review, never conclusions.",
          context: caseContext(),
        });
        const p = parseSections(answer, [...H]);
        const r: CourtAiReview = {
          summary: p["CASE SUMMARY"],
          issues: p["ISSUES FROM THE ARB DECISION"],
          gaps: p["EVIDENCE GAPS"],
          valuation: p["VALUATION QUESTIONS"],
          procedural: p["PROCEDURAL MATTERS"],
          at: new Date().toISOString(),
        };
        if (H.every((h) => p[h].length === 0))
          throw new Error("The AI reply couldn't be read. Please try again.");
        await save({ aiReview: r });
      },
      "Could not review the case.",
    );
  }

  async function generateQuestions() {
    await run(
      "questions",
      async () => {
        const { answer } = await askAboutDocument({
          question:
            `${NO_LEGAL} Write 8 questions this owner should discuss with a property-tax attorney about THIS specific case. Include: what are the strongest issues to review in this case; what additional evidence may be needed; are there procedural issues with the ARB hearing or order that should be examined; what are the expected legal costs and next steps; what are the applicable filing requirements and deadlines. ` +
            "Make them specific to this property and case. Reply with a numbered list, one question per line, and no other text.",
          context: caseContext(),
        });
        const list = parseBulletList(answer).slice(0, 8);
        if (list.length === 0) throw new Error("The AI reply couldn't be read. Please try again.");
        await save({ questions: list });
      },
      "Could not write the questions.",
    );
  }

  // ── Attorney package ─────────────────────────────────────────────────
  const summarySections = () => {
    const ai = data.aiReview;
    const r = research.research;
    return [
      {
        heading: "Property and ownership",
        lines: [
          property.address,
          `${property.cad ?? "—"} - account ${property.accountNumber ?? "—"}`,
          `Owner: ${property.ownerName ?? "—"}; type: ${property.propertyType ?? "—"}; tax year ${property.taxYear ?? "—"}`,
        ],
      },
      {
        heading: "ARB result and deadline",
        lines: [
          `Original value: ${currency(numbers.originalValue)}`,
          `ARB value: ${currency(numbers.arbValue)} (${protest.arbDecision ?? "—"}${protest.arbDecisionDate ? `, order dated ${protest.arbDecisionDate}` : ""})`,
          `Owner's requested value: ${requestedValue != null ? currency(requestedValue) : "not stated"}`,
          `Difference: ${numbers.difference != null ? currency(numbers.difference) : "—"}`,
          `Order received: ${data.orderReceivedDate ?? "not recorded"}`,
          `Court appeal deadline (60 days): ${review.deadline ?? "unknown"} - ${review.daysRemaining ?? "?"} days remaining`,
        ],
      },
      {
        heading: "Main protest arguments",
        lines: [
          caseData?.strategyRecommendation
            ? `${caseData.strategyRecommendation}${caseData.strategyRationale ? ` - ${caseData.strategyRationale}` : ""}`
            : "No strategy on file.",
        ],
      },
      {
        heading: `Evidence already submitted (${evidenceDocuments.length})`,
        lines: evidenceDocuments.length
          ? evidenceDocuments.map((d) => d.fileName)
          : ["None on file."],
      },
      {
        heading: "Comparable properties / market data and valuation (AI module findings)",
        lines: facts.moduleFindings.length
          ? facts.moduleFindings.map((m) => `${m.title}: ${m.finding}`)
          : ["No module findings on file."],
      },
      {
        heading: "Hearing history",
        lines: [
          facts.hearingNotice
            ? `${facts.hearingNotice.hearingType ?? "Hearing"} on ${facts.hearingNotice.hearingDate ?? "—"}`
            : protest.hearingDate
              ? `Hearing on ${protest.hearingDate}`
              : "No hearing notice on file.",
          `Informal review: ${protest.informalStatus}`,
        ],
      },
      {
        heading: "Case timeline",
        lines: timeline.length
          ? timeline.map((t) => `${t.date}: ${t.title}`)
          : ["No court activity recorded yet."],
      },
      ...(ai
        ? [
            { heading: "AI case summary (organization, not legal advice)", lines: ai.summary },
            {
              heading: "Issues / unanswered points from the ARB decision",
              lines: [...(facts.decisionNotice?.discrepancies ?? []), ...ai.issues],
            },
            { heading: "Potential evidence gaps", lines: ai.gaps },
            { heading: "Valuation questions", lines: ai.valuation },
            { heading: "Procedural matters to ask about", lines: ai.procedural },
          ]
        : []),
      ...(data.questions?.length
        ? [{ heading: "Questions for attorney", lines: data.questions }]
        : []),
      ...(r && (r.statewide.length || r.countySpecific.length)
        ? [
            {
              heading: `Filing requirements researched from official sources (${r.county} County, retrieved ${r.retrievedAt.slice(0, 10)})`,
              lines: [...r.statewide, ...r.countySpecific].map(
                (i) => `${i.text}${i.sourceUrl ? ` (${i.sourceUrl})` : ""}`,
              ),
            },
          ]
        : []),
      { heading: "Note", lines: [COURT_DISCLAIMER] },
    ];
  };

  async function generatePackage() {
    await run(
      "package",
      async () => {
        const files = [];
        for (const d of evidenceDocuments) {
          const bytes = await fetch(await getDocumentUrl(d.storagePath)).then((r) =>
            r.arrayBuffer(),
          );
          files.push({ fileName: d.fileName, bytes });
        }
        const bytes = await buildAttorneyPackagePdf({
          title: "Case Package for Attorney Review",
          subtitle: `${property.address} - prepared ${new Date().toLocaleDateString()} by Corvus AI (organization only, not legal advice)`,
          sections: summarySections(),
          evidence: files,
        });
        const name = `Attorney-Package-${property.accountNumber ?? property.id}.pdf`;
        downloadPdf(bytes, name);
        const doc = await uploadDocument(
          userId,
          property.id,
          new File([bytes as BlobPart], name, { type: "application/pdf" }),
          ATTORNEY_PACKAGE_TYPE,
        );
        await save({ packageAt: new Date().toISOString(), packageDocumentId: doc.id });
        toast.success("Package ready — downloaded and saved to your Documents.");
      },
      "Could not build the package.",
    );
  }

  async function openDocument(id: string | null | undefined) {
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

  const impact =
    closed && protest.finalValue != null
      ? arbitrationImpact(property, protest, protest.finalValue)
      : null;

  // the bottom action opens the popup that does it
  const openNext = () =>
    setPopup(
      next.target === "deadline"
        ? "review"
        : next.target === "package"
          ? "package"
          : next.target === "attorney"
            ? "attorney"
            : next.target === "petition"
              ? "petition"
              : next.target === "updates"
                ? "update"
                : "timeline",
    );

  const ai = data.aiReview;
  const aiCount = ai
    ? ai.issues.length + ai.gaps.length + ai.valuation.length + ai.procedural.length
    : 0;

  return (
    <div className="grid gap-3">
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning-foreground">
        {COURT_DISCLAIMER}
      </p>

      {/* Progress */}
      <ol className="flex flex-wrap gap-1 text-[11px]" aria-label="Court appeal progress">
        {stages.map((s, i) => (
          <li
            key={s.id}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
              s.state === "done"
                ? "bg-success/15 text-success"
                : s.state === "current"
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "bg-secondary text-muted-foreground"
            }`}
            aria-current={s.state === "current" ? "step" : undefined}
          >
            {s.state === "done" ? <Check className="h-3 w-3" aria-hidden /> : <span>{i + 1}</span>}
            {s.label}
          </li>
        ))}
      </ol>

      {missing.length > 0 && !closed && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
          <div className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Missing — Corvus AI won&apos;t
            assume these
          </div>
          <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
            {missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Compact status cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          icon={<CalendarClock className="h-4 w-4" />}
          title="Appeal eligibility & deadline"
          action={{ label: "Court Appeal Review", onClick: () => setPopup("review") }}
          done={!!data.deadlineAckAt}
        >
          {!review.ready ? (
            <span className="text-muted-foreground">Record the ARB decision first.</span>
          ) : (
            <>
              <div className="font-semibold">{fmtDate(review.deadline)}</div>
              <div
                className={
                  review.expired
                    ? "text-destructive"
                    : (review.daysRemaining ?? 99) <= 14
                      ? "text-warning-foreground"
                      : "text-muted-foreground"
                }
              >
                {review.daysRemaining == null
                  ? "—"
                  : review.daysRemaining < 0
                    ? `Passed ${-review.daysRemaining} days ago`
                    : `${review.daysRemaining} days left`}
                {review.basis === "order" ? " · from the order date" : ""}
              </div>
              <div className="text-muted-foreground">{review.courtName ?? "District court"}</div>
            </>
          )}
        </Card>

        <Card icon={<Scale className="h-4 w-4" />} title="ARB result vs your value">
          <div>
            ARB: <span className="font-semibold">{currency(numbers.arbValue)}</span>
          </div>
          <div>
            Yours:{" "}
            <span className="font-semibold">
              {requestedValue != null ? currency(requestedValue) : "Not on file"}
            </span>
          </div>
          <div className="text-muted-foreground">
            Difference: {numbers.difference != null ? currency(numbers.difference) : "—"}
          </div>
        </Card>

        <Card
          icon={<Sparkles className="h-4 w-4" />}
          title="AI case review"
          action={{
            label: ai ? "View AI Case Review" : "Run AI Case Review",
            onClick: () => {
              setPopup("ai");
              if (!ai) void runAiReview();
            },
          }}
          done={!!ai}
        >
          {ai ? (
            <>
              <div>{aiCount} points to discuss with an attorney</div>
              <div className="line-clamp-2 text-muted-foreground">
                {ai.issues[0] ?? ai.summary[0]}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">
              Reviews your existing case — nothing to upload again.
            </span>
          )}
        </Card>

        <Card
          icon={<Briefcase className="h-4 w-4" />}
          title="Attorney"
          action={{
            label: data.attorney ? "Edit Attorney Details" : "Add Attorney",
            onClick: () => setPopup("attorney"),
          }}
          done={!!data.attorney}
        >
          {data.attorney ? (
            <>
              <div className="font-semibold">{data.attorney.name}</div>
              <div className="text-muted-foreground">
                {[data.attorney.firm, data.attorney.reference && `Ref ${data.attorney.reference}`]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">
              {data.legalReviewDoneAt ? "Legal review done without an attorney." : "Not added yet."}
            </span>
          )}
        </Card>

        <Card
          icon={<FileText className="h-4 w-4" />}
          title="Evidence & attorney package"
          action={{ label: "Prepare Case for Attorney", onClick: () => setPopup("package") }}
          done={!!data.packageAt}
        >
          <div>
            {evidenceDocuments.length} evidence file{evidenceDocuments.length === 1 ? "" : "s"}{" "}
            carried forward
          </div>
          {data.packageAt ? (
            <button
              type="button"
              onClick={() => void openDocument(data.packageDocumentId)}
              disabled={!data.packageDocumentId}
              className="text-accent hover:underline disabled:opacity-60"
            >
              View Attorney Case Package ({fmtDate(data.packageAt)})
            </button>
          ) : (
            <span className="text-muted-foreground">Package not prepared yet.</span>
          )}
        </Card>

        <Card
          icon={<Gavel className="h-4 w-4" />}
          title="Court case"
          action={
            closed
              ? { label: "View timeline", onClick: () => setPopup("timeline") }
              : filed
                ? { label: "Add Court Update", onClick: () => setPopup("update") }
                : { label: "Confirm Petition Filed", onClick: () => setPopup("petition") }
          }
          done={filed}
        >
          {filed ? (
            <>
              <div className="font-semibold">
                {closed ? "Resolved" : "In progress"} · filed {fmtDate(data.petitionFiledAt)}
              </div>
              <div className="text-muted-foreground">
                {[data.court, data.caseNumber && `Case ${data.caseNumber}`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {!data.filingConfirmationDocumentId && !closed && (
                <button
                  type="button"
                  onClick={() => setPopup("confirmation")}
                  className="text-accent hover:underline"
                >
                  Upload Court Filing Confirmation
                </button>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              Not filed. You and your attorney file the petition — CorvusPT doesn&apos;t.
            </span>
          )}
        </Card>
      </div>

      {/* Deadlines + recent activity */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-muted-foreground">
            Upcoming deadlines
          </div>
          {upcoming.length ? (
            <ul className="mt-1 grid gap-1">
              {upcoming.map((u, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{u.label}</span>
                  <span className="shrink-0 font-medium">
                    {fmtDate(u.date)}
                    {u.days != null ? ` · ${u.days}d` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">None recorded.</p>
          )}
        </div>
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="flex items-center justify-between font-semibold uppercase tracking-wide text-muted-foreground">
            Recent activity
            {timeline.length > 0 && (
              <button
                type="button"
                onClick={() => setPopup("timeline")}
                className="normal-case text-accent hover:underline"
              >
                Full timeline
              </button>
            )}
          </div>
          {timeline.length ? (
            <ul className="mt-1 grid gap-1">
              {timeline
                .slice(-3)
                .reverse()
                .map((t, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{fmtDate(t.date)}</span> · {t.title}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">Nothing yet.</p>
          )}
          {filed && !closed && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPopup("update")}
                className="text-accent hover:underline"
              >
                Upload Court Documents
              </button>
              <button
                type="button"
                onClick={() => setPopup("resolve")}
                className="text-accent hover:underline"
              >
                Record resolution
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Result */}
      {closed && impact && (
        <ResultPanel
          protest={protest}
          property={property}
          data={data}
          impact={impact}
          busy={busy}
          onRefund={(patch) =>
            void run(
              "refund",
              () =>
                save({
                  refund: { ...(data.refund ?? { expected: null, status: "pending" }), ...patch },
                }),
              "Could not save.",
            )
          }
        />
      )}

      {/* The one thing that's needed next */}
      {!closed && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-card px-3 py-2 shadow-md">
          <span className="text-xs text-muted-foreground">Next step</span>
          <button type="button" onClick={openNext} className="btn-accent py-1.5 text-xs">
            {next.label}
          </button>
        </div>
      )}

      {/* ── Popups ─────────────────────────────────────────────────────── */}
      <Popup open={popup === "review"} onClose={() => setPopup(null)} title="Court Appeal Review">
        <ReviewBody
          review={review}
          numbers={numbers}
          protest={protest}
          data={data}
          requestedValue={requestedValue}
          enteredValue={enteredValue}
          setEnteredValue={setEnteredValue}
          missing={missing}
          busy={busy}
          onReceived={(v) =>
            void run(
              "received",
              () => save({ orderReceivedDate: v || null }),
              "Could not save the date.",
            )
          }
          onAck={() =>
            void run(
              "ack",
              () => save({ deadlineAckAt: new Date().toISOString() }),
              "Could not save.",
            )
          }
          onResearch={() => setPopup("research")}
        />
      </Popup>

      <Popup
        open={popup === "research"}
        onClose={() => setPopup("review")}
        title="Court appeal requirements — official sources"
        description="Researched by Corvus AI from the Texas Comptroller, SOAH and your county's own sites."
      >
        <CountyResearchPanel
          research={research.research}
          loading={research.loading}
          onRefresh={research.reload}
        />
      </Popup>

      <Popup
        open={popup === "ai"}
        onClose={() => setPopup(null)}
        title="AI case review"
        description="Built from your existing protest and hearing case. Areas to review with an attorney — not legal conclusions, and never a prediction."
      >
        {busy === "ai" && !ai ? (
          <p className="text-sm text-muted-foreground">Reviewing your case…</p>
        ) : ai ? (
          <div className="grid gap-3 text-sm">
            {(
              [
                ["Case summary for attorney review", ai.summary],
                [
                  "Issues from the ARB decision",
                  [...(facts.decisionNotice?.discrepancies ?? []), ...ai.issues],
                ],
                ["Potential evidence gaps", ai.gaps],
                ["Valuation questions", ai.valuation],
                ["Procedural matters to ask about", ai.procedural],
              ] as [string, string[]][]
            )
              .filter(([, l]) => l.length)
              .map(([h, l]) => (
                <div key={h}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </div>
                  <ul className="mt-1 grid gap-0.5">
                    {l.map((x, i) => (
                      <li key={i}>• {x}</li>
                    ))}
                  </ul>
                </div>
              ))}
            <p className="text-[11px] text-muted-foreground">
              Corvus AI · {fmtDate(ai.at)} · not legal advice.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No review yet.</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void runAiReview()}
            disabled={busy === "ai"}
            className="btn-outline py-1.5 text-xs disabled:opacity-60"
          >
            {busy === "ai" ? "Reviewing…" : ai ? "Review again" : "Run AI case review"}
          </button>
        </div>
      </Popup>

      <Popup
        open={popup === "package"}
        onClose={() => setPopup(null)}
        title="Prepare Case for Attorney"
        description="One downloadable package from your existing case — no documents to collect again."
      >
        <ul className="grid gap-1 text-sm">
          {(
            [
              ["Property and ownership details", true],
              ["ARB order and hearing documents", !!facts.decisionNotice || !!facts.hearingNotice],
              [
                `Existing evidence packet (${evidenceDocuments.length} files)`,
                evidenceDocuments.length > 0,
              ],
              ["Valuation reports and comparable properties", facts.moduleFindings.length > 0],
              ["Protest arguments and supporting calculations", !!caseData?.strategyRecommendation],
              ["Case timeline and important dates", true],
              ["AI-generated case summary", !!ai],
              ["Questions for attorney", !!data.questions?.length],
              ["Filing requirements from official sources", !!research.research?.statewide.length],
            ] as [string, boolean][]
          ).map(([l, ok]) => (
            <li key={l} className="flex gap-2">
              {ok ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0 text-center text-muted-foreground">–</span>
              )}
              <span className={ok ? "" : "text-muted-foreground"}>
                {l}
                {!ok && " — not on file yet"}
              </span>
            </li>
          ))}
        </ul>
        {data.questions?.length ? (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Questions for attorney
            </div>
            <ol className="mt-1 grid list-decimal gap-1 pl-5 text-sm">
              {data.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void generateQuestions()}
            disabled={busy === "questions"}
            className="btn-outline py-1.5 text-xs disabled:opacity-60"
          >
            {busy === "questions"
              ? "Writing…"
              : data.questions?.length
                ? "New questions"
                : "Write Questions for Attorney"}
          </button>
          {!ai && (
            <button
              type="button"
              onClick={() => void runAiReview()}
              disabled={busy === "ai"}
              className="btn-outline py-1.5 text-xs disabled:opacity-60"
            >
              {busy === "ai" ? "Reviewing…" : "Add AI case summary"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void generatePackage()}
            disabled={busy === "package"}
            className="btn-accent py-1.5 text-xs disabled:opacity-60"
          >
            {busy === "package"
              ? "Building package…"
              : data.packageAt
                ? "Rebuild & download package"
                : "Build & download package"}
          </button>
          {data.packageDocumentId && (
            <button
              type="button"
              onClick={() => void openDocument(data.packageDocumentId)}
              className="btn-outline py-1.5 text-xs"
            >
              View Attorney Case Package
            </button>
          )}
        </div>
      </Popup>

      <AttorneyPopup
        open={popup === "attorney"}
        onClose={() => setPopup(null)}
        data={data}
        property={property}
        deadline={review.deadline}
        busy={busy === "attorney"}
        onSave={(a) =>
          void run(
            "attorney",
            async () => {
              await save({
                attorney: { ...a, addedAt: data.attorney?.addedAt ?? new Date().toISOString() },
              });
              toast.success("Attorney saved.");
              setPopup(null);
            },
            "Could not save the attorney.",
          )
        }
        onNoAttorney={() =>
          void run(
            "attorney",
            async () => {
              await save({ legalReviewDoneAt: new Date().toISOString() });
              setPopup(null);
            },
            "Could not save.",
          )
        }
      />

      <PetitionPopup
        open={popup === "petition" || popup === "confirmation"}
        confirmationOnly={popup === "confirmation"}
        onClose={() => setPopup(null)}
        defaultCourt={data.court ?? review.courtName ?? ""}
        defaultCase={data.caseNumber ?? ""}
        busy={busy === "petition"}
        onSave={(v) =>
          void run(
            "petition",
            async () => {
              let docId = data.filingConfirmationDocumentId ?? null;
              if (v.file) {
                const doc = await uploadDocument(
                  userId,
                  property.id,
                  v.file,
                  "Court Filing Confirmation",
                );
                docId = doc.id;
              }
              if (!v.confirmationOnly && !v.caseNumber && !docId)
                throw new Error(
                  "Add the court case number or upload the filing confirmation — the petition isn't shown as filed without proof.",
                );
              await save(
                v.confirmationOnly
                  ? { filingConfirmationDocumentId: docId }
                  : {
                      petitionFiledAt: new Date(`${v.date}T12:00:00`).toISOString(),
                      petitionConfirmedAt: new Date().toISOString(),
                      court: v.court || review.courtName,
                      caseNumber: v.caseNumber || null,
                      filingConfirmationDocumentId: docId,
                    },
              );
              if (!v.confirmationOnly)
                void logCaseEvent(
                  protest.id,
                  "status_change",
                  "Court appeal petition confirmed filed by the owner.",
                  { caseNumber: v.caseNumber || null, confirmationDocumentId: docId },
                );
              toast.success(
                v.confirmationOnly ? "Filing confirmation saved." : "Recorded — petition filed.",
              );
              setPopup(null);
            },
            "Could not record this.",
          )
        }
      />

      <UpdatePopup
        open={popup === "update"}
        onClose={() => setPopup(null)}
        busy={busy === "update"}
        onSave={(u) =>
          void run(
            "update",
            async () => {
              let summary = u.notes.trim();
              let documentId: string | null = null;
              let deadlines: { date: string; label: string }[] = [];
              if (u.file) {
                const doc = await uploadDocument(userId, property.id, u.file, COURT_DOC_TYPE);
                documentId = doc.id;
                const r = await reviewDocument(doc.id).catch(() => null);
                if (r?.explanation) summary = r.explanation.slice(0, 1200);
                if (r?.explanation) deadlines = await extractDates(r.explanation).catch(() => []);
              }
              const title = u.title.trim() || (u.file ? u.file.name.replace(/\.[^.]+$/, "") : "");
              if (!title) throw new Error("Give the update a short title, or attach a document.");
              await save({
                updates: [
                  {
                    id: newUpdateId(),
                    date: u.date,
                    type: u.type,
                    title,
                    summary: summary || "Document uploaded.",
                    documentId,
                    deadlines,
                    addedAt: new Date().toISOString(),
                  },
                  ...(data.updates ?? []),
                ],
              });
              toast.success(
                deadlines.length
                  ? `Added — ${deadlines.length} date${deadlines.length === 1 ? "" : "s"} read from the document.`
                  : "Update added to the timeline.",
              );
              setPopup(null);
            },
            "Could not add the update.",
          )
        }
      />

      <ResolvePopup
        open={popup === "resolve"}
        onClose={() => setPopup(null)}
        property={property}
        protest={protest}
        busy={busy === "resolve"}
        onSave={(value, file) =>
          void run(
            "resolve",
            async () => {
              let updates = data.updates ?? [];
              if (file) {
                const doc = await uploadDocument(userId, property.id, file, COURT_DOC_TYPE);
                updates = [
                  {
                    id: newUpdateId(),
                    date: todayIso(),
                    type: "order",
                    title: "Judgment / settlement document",
                    summary: `Final value ${currency(value)}.`,
                    documentId: doc.id,
                    addedAt: new Date().toISOString(),
                  },
                  ...updates,
                ];
              }
              // a refund is due on tax already paid above the final value
              const arbValue = protest.finalValue ?? protest.originalValue ?? null;
              const expected =
                arbValue != null && arbValue > value
                  ? Math.round((arbValue - value) * getEffectiveTaxRate(property.cad))
                  : null;
              await save({
                updates,
                refund: expected
                  ? { expected, status: "pending" }
                  : { expected: null, status: "not_applicable" },
              });
              await recordFinalValueOnProperty(protest.id, property.id, value);
              onUpdate({
                finalValue: value,
                status: "resolved",
                closedAt: new Date().toISOString(),
              });
              toast.success(
                `Case resolved at ${currency(value)} — the property record is updated.`,
              );
              setPopup(null);
            },
            "Could not close the case.",
          )
        }
      />

      <Popup open={popup === "timeline"} onClose={() => setPopup(null)} title="Court case timeline">
        <ol className="grid gap-3 border-l border-border pl-4">
          {timeline.map((t, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <div className="text-xs text-muted-foreground">{fmtDate(t.date)}</div>
              <div className="font-medium">{t.title}</div>
              {t.detail && (
                <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                  {t.detail}
                </p>
              )}
            </li>
          ))}
        </ol>
        {(data.updates ?? []).some((u) => u.documentId) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(data.updates ?? [])
              .filter((u) => u.documentId)
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void openDocument(u.documentId)}
                  className="text-accent hover:underline"
                >
                  {u.title} ({UPDATE_TYPE_LABEL[u.type]})
                </button>
              ))}
          </div>
        )}
      </Popup>
    </div>
  );
}

// Dates and deadlines in an AI summary of a court document.
async function extractDates(text: string): Promise<{ date: string; label: string }[]> {
  const { answer } = await askAboutDocument({
    question:
      "List every date or deadline stated in this court document summary that the owner or attorney must act on or attend (hearings, response deadlines, settlement deadlines). One per line exactly as YYYY-MM-DD | what it is. Only dates actually stated; no other text. If none, reply NONE.",
    context: text,
  });
  return answer
    .split(/\r?\n/)
    .map((l) => l.match(/(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ date: m[1], label: m[2].trim().slice(0, 140) }))
    .slice(0, 8);
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Card({
  icon,
  title,
  children,
  action,
  done,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  done?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-md border border-border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="text-accent">{icon}</span>
          {title}
        </span>
        {done && <Check className="h-3.5 w-3.5 text-success" aria-label="Done" />}
      </div>
      <div className="mt-1.5 grid flex-1 gap-0.5 text-sm">{children}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-outline mt-2 self-start py-1 text-xs"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function Popup({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const input = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";

function ReviewBody({
  review,
  numbers,
  protest,
  data,
  requestedValue,
  enteredValue,
  setEnteredValue,
  missing,
  busy,
  onReceived,
  onAck,
  onResearch,
}: {
  review: ReturnType<typeof reviewCourtAppeal>;
  numbers: ReturnType<typeof buildArbitrationNumbers>;
  protest: ProtestRecord;
  data: CourtAppealData;
  requestedValue: number | null;
  enteredValue: string;
  setEnteredValue: (v: string) => void;
  missing: string[];
  busy: string | null;
  onReceived: (v: string) => void;
  onAck: () => void;
  onResearch: () => void;
}) {
  const rows: [string, string][] = [
    ["ARB final determined value", currency(numbers.arbValue)],
    ["Your requested value", requestedValue != null ? currency(requestedValue) : "Not on file"],
    [
      "Difference",
      numbers.difference != null
        ? `${currency(numbers.difference)}${numbers.differencePct != null ? ` (${numbers.differencePct.toFixed(1)}%)` : ""}`
        : "—",
    ],
    ["ARB decision / order date", fmtDate(protest.arbDecisionDate)],
    [
      "Date you received the order",
      data.orderReceivedDate ? fmtDate(data.orderReceivedDate) : "Not entered",
    ],
    ["Court appeal deadline", fmtDate(review.deadline)],
    [
      "Days remaining",
      review.daysRemaining == null
        ? "—"
        : review.daysRemaining < 0
          ? `Passed ${-review.daysRemaining} days ago`
          : `${review.daysRemaining} days`,
    ],
    ["Court", review.courtName ?? "District court of the county"],
  ];
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-md bg-secondary/40 p-2.5">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="font-medium">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="grid gap-1">
          <span className="text-muted-foreground">
            Date you received the order (the 60 days run from this)
          </span>
          <input
            type="date"
            value={data.orderReceivedDate ?? ""}
            onChange={(e) => onReceived(e.target.value)}
            className={input}
          />
        </label>
        {requestedValue == null && (
          <label className="grid gap-1">
            <span className="text-muted-foreground">
              Your opinion of value (not on your Notice)
            </span>
            <input
              value={enteredValue}
              onChange={(e) => setEnteredValue(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 2,500,000"
              className={input}
            />
          </label>
        )}
      </div>
      {missing.length > 0 && (
        <ul className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
          {missing.map((m) => (
            <li key={m}>• {m}</li>
          ))}
        </ul>
      )}
      {review.expired && (
        <p className="text-xs font-medium text-destructive">
          The 60-day window appears to have passed. Talk to an attorney right away — the receipt
          date and statutory exceptions can change the deadline.
        </p>
      )}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Basic filing requirements &amp; important considerations
        </div>
        <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
          {review.requirements.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResearch}
          className="btn-outline inline-flex items-center gap-1 py-1.5 text-xs"
        >
          <Landmark className="h-3.5 w-3.5" aria-hidden /> Court &amp; filing requirements (official
          sources)
        </button>
        {!data.deadlineAckAt && review.ready && (
          <button
            type="button"
            onClick={onAck}
            disabled={busy === "ack"}
            className="btn-accent py-1.5 text-xs disabled:opacity-60"
          >
            I&apos;ve reviewed the deadline
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The general 60-day deadline counts from receipt of the ARB order (Tax Code §42.21), subject
        to statutory rules and exceptions — have an attorney confirm it.
      </p>
    </div>
  );
}

function AttorneyPopup({
  open,
  onClose,
  data,
  property,
  deadline,
  busy,
  onSave,
  onNoAttorney,
}: {
  open: boolean;
  onClose: () => void;
  data: CourtAppealData;
  property: PropertyRecord;
  deadline: string | null;
  busy: boolean;
  onSave: (a: {
    name: string;
    firm: string;
    email: string;
    phone: string;
    reference: string;
  }) => void;
  onNoAttorney: () => void;
}) {
  const [a, setA] = useState({
    name: data.attorney?.name ?? "",
    firm: data.attorney?.firm ?? "",
    email: data.attorney?.email ?? "",
    phone: data.attorney?.phone ?? "",
    reference: data.attorney?.reference ?? "",
  });
  return (
    <Popup
      open={open}
      onClose={onClose}
      title="Attorney Details"
      description="Keep your attorney's contact and case reference with the case."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["name", "Attorney's name"],
            ["firm", "Law firm"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["reference", "Case / matter reference"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="grid gap-1 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <input
              value={a[k]}
              onChange={(e) => setA((x) => ({ ...x, [k]: e.target.value }))}
              className={input}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            a.name.trim()
              ? onSave({ ...a, name: a.name.trim() })
              : toast.error("Enter the attorney's name.")
          }
          disabled={busy}
          className="btn-accent py-1.5 text-xs disabled:opacity-60"
        >
          {data.attorney ? "Update attorney" : "Add attorney"}
        </button>
        {data.attorney?.email && (
          <a
            className="text-xs text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
            href={`mailto:${data.attorney.email}?subject=${encodeURIComponent(`Property tax appeal - ${property.address}`)}&body=${encodeURIComponent(`Hello ${data.attorney.name},\n\nAttached is the case package for ${property.address}. Court appeal deadline: ${deadline ?? "TBD"}.\n\n(Attach the downloaded Attorney-Package PDF.)`)}`}
          >
            Email the attorney →
          </a>
        )}
        {!data.attorney && !data.legalReviewDoneAt && (
          <button
            type="button"
            onClick={onNoAttorney}
            className="text-xs text-muted-foreground hover:underline"
          >
            Proceeding without an attorney
          </button>
        )}
      </div>
    </Popup>
  );
}

function PetitionPopup({
  open,
  confirmationOnly,
  onClose,
  defaultCourt,
  defaultCase,
  busy,
  onSave,
}: {
  open: boolean;
  confirmationOnly: boolean;
  onClose: () => void;
  defaultCourt: string;
  defaultCase: string;
  busy: boolean;
  onSave: (v: {
    date: string;
    court: string;
    caseNumber: string;
    file: File | null;
    confirmationOnly: boolean;
  }) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [court, setCourt] = useState(defaultCourt);
  const [caseNumber, setCaseNumber] = useState(defaultCase);
  const [file, setFile] = useState<File | null>(null);
  return (
    <Popup
      open={open}
      onClose={onClose}
      title={confirmationOnly ? "Upload Court Filing Confirmation" : "Confirm Petition Filed"}
      description="You and your attorney file the petition with the court — CorvusPT does not. Record it here once it's filed, with the case number or the court's filing confirmation."
    >
      {!confirmationOnly && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Date filed</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={input}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Court</span>
            <input value={court} onChange={(e) => setCourt(e.target.value)} className={input} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Cause / case number</span>
            <input
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              className={input}
            />
          </label>
        </div>
      )}
      <label className="btn-outline mt-3 inline-flex w-fit cursor-pointer py-1.5 text-xs">
        {file ? file.name : "Attach filing confirmation (e-file receipt, file-stamped petition)"}
        <input
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <button
        type="button"
        onClick={() =>
          onSave({
            date,
            court: court.trim(),
            caseNumber: caseNumber.trim(),
            file,
            confirmationOnly,
          })
        }
        disabled={busy || (confirmationOnly && !file)}
        className="btn-accent mt-3 block py-1.5 text-xs disabled:opacity-60"
      >
        {busy ? "Saving…" : confirmationOnly ? "Save confirmation" : "Yes — the petition was filed"}
      </button>
    </Popup>
  );
}

function UpdatePopup({
  open,
  onClose,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSave: (u: {
    date: string;
    type: CourtUpdateType;
    title: string;
    notes: string;
    file: File | null;
  }) => void;
}) {
  const [u, setU] = useState({
    date: todayIso(),
    type: "notice" as CourtUpdateType,
    title: "",
    notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  return (
    <Popup
      open={open}
      onClose={onClose}
      title="Add Court Update / Upload Court Documents"
      description="Court notices, filed petitions, orders, settlement offers, hearing notices and correspondence. Corvus AI reads an uploaded document, summarizes it and adds its dates to your deadlines."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Date</span>
          <input
            type="date"
            value={u.date}
            onChange={(e) => setU((x) => ({ ...x, date: e.target.value }))}
            className={input}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Type</span>
          <select
            value={u.type}
            onChange={(e) => setU((x) => ({ ...x, type: e.target.value as CourtUpdateType }))}
            className={input}
          >
            {(Object.keys(UPDATE_TYPE_LABEL) as CourtUpdateType[]).map((t) => (
              <option key={t} value={t}>
                {UPDATE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Title (or attach a document)</span>
          <input
            value={u.title}
            onChange={(e) => setU((x) => ({ ...x, title: e.target.value }))}
            placeholder="e.g. Scheduling order"
            className={input}
          />
        </label>
      </div>
      <textarea
        value={u.notes}
        onChange={(e) => setU((x) => ({ ...x, notes: e.target.value }))}
        rows={2}
        placeholder="Notes (optional — or upload the document and Corvus AI will summarize it)"
        className={`${input} mt-2 w-full`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="btn-outline inline-flex cursor-pointer py-1.5 text-xs">
          {file ? file.name : "Attach document"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          onClick={() => onSave({ ...u, file })}
          disabled={busy}
          className="btn-accent py-1.5 text-xs disabled:opacity-60"
        >
          {busy ? "Reading & saving…" : "Add to case"}
        </button>
      </div>
    </Popup>
  );
}

function ResolvePopup({
  open,
  onClose,
  property,
  protest,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  property: PropertyRecord;
  protest: ProtestRecord;
  busy: boolean;
  onSave: (value: number, file: File | null) => void;
}) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  async function choose(f: File) {
    setFile(f);
    setReading(true);
    try {
      const ex = await extractDecisionDocument(property, protest, f);
      if (ex.finalValue && ex.finalValue > 0) {
        setValue(String(ex.finalValue));
        toast.success(`Read ${currency(ex.finalValue)} from the document — check it, then record.`);
      } else toast.info("Couldn't read a final value from the document — enter it below.");
    } catch {
      toast.info("Couldn't read the document — enter the final value below.");
    } finally {
      setReading(false);
    }
  }
  return (
    <Popup
      open={open}
      onClose={onClose}
      title="Record the court case result"
      description="The final court-determined or settlement value. Corvus AI updates your case and property record and returns the property to tax monitoring."
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="Final value, e.g. 2,700,000"
          aria-label="Final value"
          className={input}
        />
        <label
          className={`btn-outline inline-flex cursor-pointer py-1.5 text-xs ${reading ? "pointer-events-none opacity-60" : ""}`}
        >
          {reading ? "Reading document…" : file ? file.name : "Upload judgment / settlement"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={reading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void choose(f);
            }}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => {
          const v = parseMoney(value);
          if (!v) return toast.error("Enter the final value.");
          onSave(v, file);
        }}
        disabled={busy || reading}
        className="btn-accent mt-3 py-1.5 text-xs disabled:opacity-60"
      >
        {busy ? "Saving…" : "Record resolution"}
      </button>
    </Popup>
  );
}

function ResultPanel({
  protest,
  data,
  impact,
  busy,
  onRefund,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  data: CourtAppealData;
  impact: ReturnType<typeof arbitrationImpact>;
  busy: string | null;
  onRefund: (patch: Partial<NonNullable<CourtAppealData["refund"]>>) => void;
}) {
  const [amount, setAmount] = useState("");
  const refund = data.refund;
  return (
    <div className="rounded-md border border-success/40 bg-success/5 p-3 text-sm">
      <div className="font-semibold">Court appeal result</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Final value</div>
          <strong>{currency(protest.finalValue)}</strong>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Reduction</div>
          <strong className="text-success">{currency(impact.reduction)}</strong>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Tax impact (est.)</div>
          <strong className="text-success">
            {impact.taxSavings != null ? `${currency(impact.taxSavings)} / yr` : "—"}
          </strong>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Refund</div>
          {refund?.status === "received" ? (
            <strong className="text-success">
              Received {refund.amount != null ? currency(refund.amount) : ""}
            </strong>
          ) : refund?.status === "pending" ? (
            <strong>~{currency(refund.expected)} expected (est.)</strong>
          ) : (
            <span className="text-muted-foreground">None expected</span>
          )}
        </div>
      </div>
      {refund?.status === "pending" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Refund amount received"
            className={input}
          />
          <button
            type="button"
            disabled={busy === "refund"}
            onClick={() =>
              onRefund({
                status: "received",
                amount: parseMoney(amount),
                receivedAt: new Date().toISOString(),
              })
            }
            className="btn-outline py-1 text-xs"
          >
            Record refund received
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        The property record now carries the final value; it&apos;s back in tax monitoring for next
        year.
        <Link to="/dashboard/properties" className="btn-outline py-1 text-xs">
          Go to my properties
        </Link>
      </div>
    </div>
  );
}
