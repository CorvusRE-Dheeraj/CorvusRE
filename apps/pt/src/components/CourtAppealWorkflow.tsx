import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import type { ProtestCase } from "@/lib/protest-case";
import { closeCase, saveCourtAppeal } from "@/lib/protest-case";
import { logCaseEvent } from "@/lib/case-audit";
import { getDocumentUrl, uploadDocument, type DocumentRecord } from "@/lib/documents";
import { reviewDocument } from "@/lib/document-review";
import { askAboutDocument } from "@/lib/document-ai";
import { downloadPdf } from "@/lib/protest-documents";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";
import { useCaseFacts } from "@/hooks/use-case-facts";
import { buildCaseContext } from "@/lib/case-context";
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
  courtNextAction,
  courtStages,
  courtTimeline,
  newUpdateId,
  reviewCourtAppeal,
  type CourtAppealData,
  type CourtUpdateType,
} from "@/lib/court-appeal";
import { buildAttorneyPackagePdf } from "@/lib/court-appeal-package";

const COURT_DOC_TYPE = "Court Appeal Document";
const ATTORNEY_PACKAGE_TYPE = "Attorney Case Package";
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString() : "—";

const SECTION_ID: Record<string, string> = {
  deadline: "court-deadline",
  package: "court-package",
  attorney: "court-attorney",
  petition: "court-petition",
  updates: "court-updates",
  resolution: "court-resolution",
  monitoring: "court-monitoring",
};

// The court-appeal leg of a case. It continues the SAME protest — the property,
// evidence, arguments and hearing history already on file are reused, never
// asked for again. Corvus organizes (deadline, summary, attorney package,
// timeline, document summaries); it does not file the petition or give legal
// advice, and only marks the petition filed once the owner confirms it.
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
  const [enteredValue, setEnteredValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<{ issues: string[]; areas: string[] } | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [attorney, setAttorney] = useState({
    name: data.attorney?.name ?? "",
    firm: data.attorney?.firm ?? "",
    email: data.attorney?.email ?? "",
    phone: data.attorney?.phone ?? "",
  });
  const [filedDate, setFiledDate] = useState(todayIso());
  const [court, setCourt] = useState(data.court ?? "");
  const [caseNumber, setCaseNumber] = useState(data.caseNumber ?? "");
  const [upd, setUpd] = useState({
    date: todayIso(),
    type: "notice" as CourtUpdateType,
    title: "",
    notes: "",
  });
  const [updFile, setUpdFile] = useState<File | null>(null);
  const [finalInput, setFinalInput] = useState("");

  const requestedValue = facts.requestedValue ?? parseMoney(enteredValue);
  const review = useMemo(
    () => reviewCourtAppeal(property, protest, data),
    // data changes identity on every save; the fields that matter are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [property, protest, protest.courtAppeal],
  );
  const numbers = buildArbitrationNumbers(property, protest, requestedValue);
  const stages = courtStages(protest, data);
  const next = courtNextAction(protest, data);
  const closed = protest.status === "resolved";
  const filed = !!data.petitionFiledAt;
  const timeline = courtTimeline(data);

  async function save(patch: Partial<CourtAppealData>) {
    const merged: CourtAppealData = { ...data, ...patch };
    await saveCourtAppeal(protest.id, merged);
    onUpdate({ courtAppeal: merged });
    return merged;
  }

  async function run<T>(
    key: string,
    fn: () => Promise<T>,
    failure: string,
  ): Promise<T | undefined> {
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

  const NO_LEGAL =
    "You are helping organize a case for attorney review. Do NOT give legal advice, legal conclusions, or any prediction about who will win.";

  async function runAiReview() {
    await run(
      "review",
      async () => {
        const { answer } = await askAboutDocument({
          question:
            `${NO_LEGAL} Review this protest and hearing case. Reply in exactly this format and nothing else:\n` +
            "ISSUES FROM THE ARB DECISION:\n- (up to 4 short bullets: important issues or points from the ARB decision/order that look unanswered or worth a closer look)\n" +
            "AREAS TO REVIEW FURTHER:\n- (up to 5 short bullets: areas the owner and attorney may want to look at more closely — phrased as things to review, not conclusions)",
          context: caseContext(),
        });
        const parsed = parseSections(answer, [
          "ISSUES FROM THE ARB DECISION",
          "AREAS TO REVIEW FURTHER",
        ]);
        setAiReview({
          issues: parsed["ISSUES FROM THE ARB DECISION"],
          areas: parsed["AREAS TO REVIEW FURTHER"],
        });
        if (
          parsed["ISSUES FROM THE ARB DECISION"].length === 0 &&
          parsed["AREAS TO REVIEW FURTHER"].length === 0
        ) {
          throw new Error("The AI reply couldn't be read. Please try again.");
        }
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
            `${NO_LEGAL} Write 8 questions this owner should discuss with a property-tax attorney about THIS specific case, ` +
            "including: what is the strongest issue in this case; what additional evidence may be needed; are there procedural issues with the ARB hearing or order that should be reviewed; " +
            "what are the expected costs and next steps. Reply with a numbered list, one question per line, and no other text.",
          context: caseContext(),
        });
        const list = parseBulletList(answer).slice(0, 8);
        if (list.length === 0) throw new Error("The AI reply couldn't be read. Please try again.");
        setQuestions(list);
      },
      "Could not write the questions.",
    );
  }

  const summarySections = () => {
    const f = facts;
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
        heading: "Comparable properties / market data (AI module findings)",
        lines: f.moduleFindings.length
          ? f.moduleFindings.map((m) => `${m.title}: ${m.finding}`)
          : ["No module findings on file."],
      },
      {
        heading: "Hearing history",
        lines: [
          f.hearingNotice
            ? `${f.hearingNotice.hearingType ?? "Hearing"} on ${f.hearingNotice.hearingDate ?? "—"}`
            : protest.hearingDate
              ? `Hearing on ${protest.hearingDate}`
              : "No hearing notice on file.",
          `Informal review: ${protest.informalStatus}`,
        ],
      },
      {
        heading: "Issues / unanswered points from the ARB decision",
        lines: [
          ...(f.decisionNotice?.discrepancies ?? []),
          ...(aiReview?.issues ?? []),
          ...(!(f.decisionNotice?.discrepancies?.length || aiReview?.issues.length)
            ? ["None flagged yet."]
            : []),
        ],
      },
      ...(aiReview?.areas.length
        ? [
            {
              heading: "Areas to review further (AI, not legal conclusions)",
              lines: aiReview.areas,
            },
          ]
        : []),
      ...(questions.length
        ? [{ heading: "Questions to discuss with an attorney", lines: questions }]
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
          subtitle: `${property.address} - prepared ${new Date().toLocaleDateString()} by Corvus (organization only, not legal advice)`,
          sections: summarySections(),
          evidence: files,
        });
        const name = `Attorney-Package-${property.accountNumber ?? property.id}.pdf`;
        downloadPdf(bytes, name);
        await uploadDocument(
          userId,
          property.id,
          new File([bytes as BlobPart], name, { type: "application/pdf" }),
          ATTORNEY_PACKAGE_TYPE,
        );
        await save({ packageAt: new Date().toISOString() });
        toast.success("Package ready — downloaded and saved to your Documents.");
      },
      "Could not build the package.",
    );
  }

  async function saveAttorney() {
    if (!attorney.name.trim()) return toast.error("Enter the attorney's name.");
    await run(
      "attorney",
      async () => {
        await save({ attorney: { ...attorney, name: attorney.name.trim() } });
        toast.success("Attorney saved.");
      },
      "Could not save the attorney.",
    );
  }

  async function confirmPetitionFiled() {
    await run(
      "petition",
      async () => {
        await save({
          petitionFiledAt: new Date(`${filedDate}T12:00:00`).toISOString(),
          court: court.trim() || review.courtName,
          caseNumber: caseNumber.trim() || null,
        });
        void logCaseEvent(
          protest.id,
          "status_change",
          "Court appeal petition confirmed filed by the owner.",
          {},
        );
        toast.success("Recorded — your petition is marked as filed.");
      },
      "Could not record this.",
    );
  }

  async function addUpdate() {
    if (!upd.title.trim()) return toast.error("Give the update a short title.");
    await run(
      "update",
      async () => {
        let summary = upd.notes.trim();
        let documentId: string | null = null;
        if (updFile) {
          const doc = await uploadDocument(userId, property.id, updFile, COURT_DOC_TYPE);
          documentId = doc.id;
          const r = await reviewDocument(doc.id).catch(() => null);
          summary = r?.explanation ? r.explanation.slice(0, 1200) : summary || "Document uploaded.";
        }
        await save({
          updates: [
            {
              id: newUpdateId(),
              date: upd.date,
              type: upd.type,
              title: upd.title.trim(),
              summary,
              documentId,
            },
            ...(data.updates ?? []),
          ],
        });
        setUpd({ date: todayIso(), type: "notice", title: "", notes: "" });
        setUpdFile(null);
        toast.success("Update added to the timeline.");
      },
      "Could not add the update.",
    );
  }

  async function resolveCase() {
    const value = parseMoney(finalInput);
    if (!value) return toast.error("Enter the final value.");
    await run(
      "resolve",
      async () => {
        await closeCase(protest.id, value);
        onUpdate({ finalValue: value, status: "resolved", closedAt: new Date().toISOString() });
        toast.success(`Case resolved at ${currency(value)}.`);
      },
      "Could not close the case.",
    );
  }

  const impact =
    closed && protest.finalValue != null
      ? arbitrationImpact(property, protest, protest.finalValue)
      : null;

  const input = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";
  const card = "rounded-md border border-border p-4";
  const h = "text-sm font-semibold";

  return (
    <div className="grid gap-4">
      {/* Case Progress */}
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

      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning-foreground">
        {COURT_DISCLAIMER}
      </p>

      {/* Court Appeal Review */}
      <section id="court-deadline" className={card}>
        <h4 className={h}>Court appeal review</h4>
        {!review.ready ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Record the ARB decision on the Decision tab (upload the ARB order) so Corvus can count
            your deadline.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["ARB final value", currency(numbers.arbValue)],
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
                  ["ARB order date", fmtDate(protest.arbDecisionDate)],
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
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="rounded-md bg-secondary/40 p-2.5">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="font-medium">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3 text-xs">
              <label className="grid gap-1">
                <span className="text-muted-foreground">
                  Date you received the order (the 60 days run from this)
                </span>
                <input
                  type="date"
                  value={data.orderReceivedDate ?? ""}
                  onChange={(e) =>
                    void run(
                      "received",
                      () => save({ orderReceivedDate: e.target.value || null }),
                      "Could not save the date.",
                    )
                  }
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
            {review.basis === "order" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Counting from the order date for now — enter the date you actually received it for
                the exact deadline.
              </p>
            )}
            {review.expired && (
              <p className="mt-2 text-xs font-medium text-destructive">
                The 60-day window appears to have passed. Talk to an attorney right away — the
                receipt date can change the deadline.
              </p>
            )}

            <div className="mt-3 text-xs">
              <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                Basic filing requirements &amp; deadlines
              </div>
              <ul className="mt-1 grid gap-1 text-muted-foreground">
                {review.requirements.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>

            {!data.deadlineAckAt && (
              <button
                type="button"
                onClick={() =>
                  void run(
                    "ack",
                    () => save({ deadlineAckAt: new Date().toISOString() }),
                    "Could not save.",
                  )
                }
                className="btn-accent mt-3 text-xs py-1.5"
              >
                I&apos;ve reviewed the deadline
              </button>
            )}
          </>
        )}
      </section>

      {review.ready && (
        <>
          {/* Case Summary for Attorney Review + AI Case Review */}
          <section className={card}>
            <h4 className={h}>Case summary for attorney review</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Built from your existing case — nothing to upload again.
            </p>
            <div className="mt-3 grid gap-3 text-xs">
              {summarySections()
                .filter((s) => s.heading !== "Note")
                .map((s) => (
                  <div key={s.heading}>
                    <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.heading}
                    </div>
                    <ul className="mt-1 grid gap-0.5">
                      {s.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void runAiReview()}
                disabled={busy === "review"}
                className="btn-accent text-xs py-1.5 disabled:opacity-60"
              >
                {busy === "review"
                  ? "Reviewing…"
                  : aiReview
                    ? "Re-run AI case review"
                    : "AI case review"}
              </button>
              <span className="ml-2 text-[11px] text-muted-foreground">
                Flags areas to look at further — not legal conclusions, and never a prediction.
              </span>
            </div>
          </section>

          {/* Prepare for Attorney */}
          <section id="court-package" className={card}>
            <h4 className={h}>Prepare for attorney</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              One clean package: the case summary above plus the {evidenceDocuments.length} evidence
              file{evidenceDocuments.length === 1 ? "" : "s"} already in your case.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void generatePackage()}
                disabled={busy === "package"}
                className="btn-accent text-xs py-1.5 disabled:opacity-60"
              >
                {busy === "package"
                  ? "Building package…"
                  : data.packageAt
                    ? "Rebuild attorney package"
                    : "Generate attorney package"}
              </button>
              <button
                type="button"
                onClick={() => void generateQuestions()}
                disabled={busy === "questions"}
                className="btn-outline text-xs py-1.5 disabled:opacity-60"
              >
                {busy === "questions"
                  ? "Writing…"
                  : questions.length
                    ? "New questions"
                    : "Questions to ask an attorney"}
              </button>
            </div>
            {data.packageAt && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Last prepared {fmtDate(data.packageAt)} — saved in your Documents as &quot;
                {ATTORNEY_PACKAGE_TYPE}&quot;.
              </p>
            )}
            {questions.length > 0 && (
              <ol className="mt-3 grid list-decimal gap-1 pl-5 text-sm">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            )}
          </section>

          {/* Attorney */}
          <section id="court-attorney" className={card}>
            <h4 className={h}>Your attorney</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add their contact details to keep everything in one place.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["name", "Name"],
                  ["firm", "Firm"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <input
                    value={attorney[k]}
                    onChange={(e) => setAttorney((a) => ({ ...a, [k]: e.target.value }))}
                    className={input}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveAttorney()}
                disabled={busy === "attorney"}
                className="btn-outline text-xs py-1.5 disabled:opacity-60"
              >
                {data.attorney ? "Update attorney" : "Save attorney"}
              </button>
              {data.attorney?.email && (
                <a
                  className="text-xs text-accent hover:underline"
                  href={`mailto:${data.attorney.email}?subject=${encodeURIComponent(`Property tax appeal - ${property.address}`)}&body=${encodeURIComponent(`Hello ${data.attorney.name},\n\nAttached is the case package for ${property.address}. Court appeal deadline: ${review.deadline ?? "TBD"}.\n\n(Attach the downloaded Attorney-Package PDF.)`)}`}
                >
                  Email the attorney →
                </a>
              )}
              {!data.attorney && !data.legalReviewDoneAt && (
                <button
                  type="button"
                  onClick={() =>
                    void run(
                      "legal",
                      () => save({ legalReviewDoneAt: new Date().toISOString() }),
                      "Could not save.",
                    )
                  }
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Mark legal review done (no attorney)
                </button>
              )}
            </div>
          </section>

          {/* Petition filed */}
          {!filed && (
            <section id="court-petition" className={card}>
              <h4 className={h}>Confirm petition filed</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You and your attorney file the petition with the court — Corvus does not. Once
                it&apos;s filed, confirm it here to start tracking the court case.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Date filed</span>
                  <input
                    type="date"
                    value={filedDate}
                    onChange={(e) => setFiledDate(e.target.value)}
                    className={input}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Court</span>
                  <input
                    value={court}
                    onChange={(e) => setCourt(e.target.value)}
                    placeholder={review.courtName ?? ""}
                    className={input}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Case number (optional)</span>
                  <input
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                    className={input}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void confirmPetitionFiled()}
                disabled={busy === "petition"}
                className="btn-accent mt-3 text-xs py-1.5 disabled:opacity-60"
              >
                {busy === "petition" ? "Saving…" : "Yes — the petition was filed"}
              </button>
            </section>
          )}
        </>
      )}

      {/* Court case: updates + timeline */}
      {filed && (
        <section id="court-updates" className={card}>
          <h4 className={h}>Court case</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Filed {fmtDate(data.petitionFiledAt)}
            {data.court ? ` · ${data.court}` : ""}
            {data.caseNumber ? ` · Case ${data.caseNumber}` : ""}. Add notices, filings, orders and
            settlement information as they arrive.
          </p>
          {!closed && (
            <div className="mt-3 grid gap-2 rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Date</span>
                  <input
                    type="date"
                    value={upd.date}
                    onChange={(e) => setUpd((u) => ({ ...u, date: e.target.value }))}
                    className={input}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Type</span>
                  <select
                    value={upd.type}
                    onChange={(e) =>
                      setUpd((u) => ({ ...u, type: e.target.value as CourtUpdateType }))
                    }
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
                  <span className="text-muted-foreground">Title</span>
                  <input
                    value={upd.title}
                    onChange={(e) => setUpd((u) => ({ ...u, title: e.target.value }))}
                    placeholder="e.g. Scheduling order"
                    className={input}
                  />
                </label>
              </div>
              <textarea
                value={upd.notes}
                onChange={(e) => setUpd((u) => ({ ...u, notes: e.target.value }))}
                rows={2}
                placeholder="Notes (optional — or upload the document and Corvus will summarize it)"
                className={input}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="btn-outline inline-flex cursor-pointer text-xs py-1.5">
                  {updFile ? updFile.name : "Attach document"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => setUpdFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void addUpdate()}
                  disabled={busy === "update"}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  {busy === "update" ? "Reading & saving…" : "Add court update"}
                </button>
              </div>
            </div>
          )}
          <ol className="mt-4 grid gap-3 border-l border-border pl-4">
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
        </section>
      )}

      {/* Resolution */}
      {filed && !closed && (
        <section id="court-resolution" className={card}>
          <h4 className={h}>Case resolved?</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When the court case ends (judgment or settlement), enter the final value. Corvus updates
            your case and returns the property to tax monitoring.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={finalInput}
              onChange={(e) => setFinalInput(e.target.value)}
              inputMode="decimal"
              placeholder="Final value, e.g. 2,700,000"
              aria-label="Final value"
              className={input}
            />
            <button
              type="button"
              onClick={() => void resolveCase()}
              disabled={busy === "resolve"}
              className="btn-outline text-xs py-1.5 disabled:opacity-60"
            >
              {busy === "resolve" ? "Saving…" : "Record resolution"}
            </button>
          </div>
        </section>
      )}

      {closed && impact && (
        <section id="court-monitoring" className={card}>
          <h4 className={h}>Court appeal result</h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Final value
              </div>
              <strong>{currency(protest.finalValue)}</strong>
              <div className="text-xs text-muted-foreground">
                from {currency(impact.before)} originally
              </div>
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

      {/* The one thing that's needed next */}
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-card px-3 py-2 shadow-md">
        <span className="text-xs text-muted-foreground">Next step</span>
        <button
          type="button"
          onClick={() => {
            const id =
              next.target === "attorney" && !review.ready
                ? "court-deadline"
                : SECTION_ID[next.target];
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="btn-accent text-xs py-1.5"
        >
          {next.label}
        </button>
      </div>
    </div>
  );
}
