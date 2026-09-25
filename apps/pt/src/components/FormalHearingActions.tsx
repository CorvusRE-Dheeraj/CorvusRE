import { useState } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import {
  extractDecisionDocument,
  saveDecisionNotice,
  type DecisionExtraction,
} from "@/lib/decision-notice";
import { DECISION_DOCUMENT_TYPE, uploadDocument } from "@/lib/documents";
import {
  closeCase,
  markHearingCompleted,
  recordArbDecision,
  recordEscalation,
  undoFormalOutcome,
  undoHearingCompleted,
} from "@/lib/protest-case";
import { UndoButton } from "@/components/UndoButton";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";

// The Formal Hearing tab's action row, mirroring the Informal Review tab's:
//  - Formal hearing completed  → marks the ARB hearing as held
//  - Submit Decision document  → reads the final value off the ARB order,
//    saves it as the hearing decision, and closes the protest at that value
//  - Unsatisfied               → asks arbitration or a court appeal, moves the
//    case there, and says so
export function FormalHearingActions({
  userId,
  protest,
  property,
  onUpdate,
  onOpenAppeal,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  onOpenAppeal: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<DecisionExtraction | null>(null);
  const [needsValue, setNeedsValue] = useState(false);
  const [valueInput, setValueInput] = useState("");

  const escalated = protest.escalationPath === "appeal" || protest.escalationPath === "arbitration";
  const resolved = protest.status === "resolved";

  if (escalated && (protest.status === "appealing" || protest.status === "arbitrating")) {
    return (
      <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="font-medium">
          Formal hearing result was unsatisfactory, so the case moved to{" "}
          {protest.escalationPath === "appeal" ? "a court appeal" : "arbitration"}.
        </p>
        <button
          type="button"
          onClick={onOpenAppeal}
          className="mt-1.5 text-xs text-accent hover:underline"
        >
          Open {protest.escalationPath === "appeal" ? "Court Appeal" : "Arbitration"} →
        </button>
        <UndoButton
          className="mt-2 block"
          label="Undo — choose again"
          confirm="This takes the case back to the formal hearing so you can choose arbitration or a court appeal again, or submit a decision document."
          successMessage="Undone — you are back at the formal hearing."
          onUndo={async () => onUpdate(await undoFormalOutcome(protest))}
        />
      </div>
    );
  }
  if (resolved) {
    return protest.arbDecision ? (
      <div className="mt-2 rounded-md border border-border p-3 text-sm">
        <p className="font-medium">
          The formal hearing decision is on file and the protest is closed.
        </p>
        <UndoButton
          className="mt-2 block"
          label="Undo this decision"
          confirm="This removes the recorded decision and reopens the case at the formal hearing, so you can submit the right document or choose arbitration / a court appeal. The uploaded file stays in your Documents tab."
          successMessage="Undone — the case is back at the formal hearing."
          onUndo={async () => onUpdate(await undoFormalOutcome(protest))}
        />
      </div>
    ) : null;
  }

  async function handleCompleted() {
    setBusy(true);
    try {
      const at = await markHearingCompleted(protest.id);
      onUpdate({ hearingCompletedAt: at });
      toast.success(
        "Formal hearing marked completed. Submit the decision document, or choose Unsatisfied if you disagree with the result.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update this."));
    } finally {
      setBusy(false);
    }
  }

  async function closeWithDecision(f: File, ex: DecisionExtraction | null, finalValue: number) {
    setBusy(true);
    try {
      const doc = await uploadDocument(userId, property.id, f, DECISION_DOCUMENT_TYPE);
      if (ex) await saveDecisionNotice(userId, protest.id, doc.id, ex);
      const original = protest.originalValue ?? property.totalValue ?? null;
      const type: "partial" | "denied" =
        original != null && finalValue < original ? "partial" : "denied";
      const date = ex?.decisionDate ?? new Date().toISOString().slice(0, 10);
      await recordArbDecision(protest.id, { type, date, finalValue });
      await closeCase(protest.id, finalValue);
      onUpdate({
        arbDecision: type,
        arbDecisionDate: date,
        finalValue,
        status: "resolved",
        closedAt: new Date().toISOString(),
      });
      setFile(null);
      setExtraction(null);
      setNeedsValue(false);
      toast.success(`Decision document submitted — protest closed at ${currency(finalValue)}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not submit the decision document."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDecisionFile(f: File) {
    setBusy(true);
    let ex: DecisionExtraction | null = null;
    try {
      ex = await extractDecisionDocument(property, protest, f);
    } catch {
      // Unreadable by AI — fall through to asking for the final value.
    }
    setBusy(false);
    const value = ex?.finalValue ?? null;
    if (value != null && value > 0) {
      await closeWithDecision(f, ex, value);
      return;
    }
    setFile(f);
    setExtraction(ex);
    setValueInput("");
    setNeedsValue(true);
  }

  async function handleConfirmValue() {
    const value = Number(valueInput.replace(/[^0-9.]/g, ""));
    if (!file || !Number.isFinite(value) || value <= 0) {
      toast.error("Enter the final value from the decision document.");
      return;
    }
    await closeWithDecision(file, extraction, value);
  }

  async function escalate(path: "appeal" | "arbitration") {
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
      setChoosing(false);
      toast.success(
        path === "appeal"
          ? "Recorded — the case moved to a court appeal."
          : "Recorded — the case moved to arbitration.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record this next step."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-border p-3">
      <div className="text-sm font-semibold">After your formal hearing</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!protest.hearingCompletedAt && (
          <button
            type="button"
            onClick={() => void handleCompleted()}
            disabled={busy}
            className="btn-outline text-xs py-1.5 disabled:opacity-60"
          >
            Formal hearing completed
          </button>
        )}
        <label
          className={`btn-accent inline-flex cursor-pointer text-xs py-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          {busy ? "Working…" : "Submit Decision document"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleDecisionFile(f);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setChoosing(true)}
          disabled={busy}
          className="btn-outline text-xs py-1.5 text-destructive disabled:opacity-60"
        >
          Unsatisfied
        </button>
      </div>
      {protest.hearingCompletedAt && (
        <UndoButton
          className="mt-1.5 block"
          label="Undo “Formal hearing completed”"
          confirm="This clears the completed mark on your formal hearing."
          successMessage="Undone."
          onUndo={async () => {
            await undoHearingCompleted(protest.id);
            onUpdate({ hearingCompletedAt: null });
          }}
        />
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {protest.hearingCompletedAt
          ? `Hearing marked completed ${new Date(protest.hearingCompletedAt).toLocaleDateString()}. `
          : ""}
        Uploading the decision document closes this protest.
      </p>

      {choosing && (
        <div className="mt-2 rounded-md border border-border p-3">
          <p className="text-sm">Do you want to proceed with arbitration or a court appeal?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void escalate("arbitration")}
              disabled={busy}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              Arbitration
            </button>
            <button
              type="button"
              onClick={() => void escalate("appeal")}
              disabled={busy}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              Court appeal
            </button>
            <button
              type="button"
              onClick={() => setChoosing(false)}
              disabled={busy}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {needsValue && file && (
        <div className="mt-2 rounded-md border border-border p-3 text-xs">
          <p className="text-muted-foreground">
            We couldn&apos;t read the final value from {file.name}. Enter it to close the protest.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              inputMode="decimal"
              placeholder="Final value, e.g. 480000"
              aria-label="Final value"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleConfirmValue()}
              disabled={busy}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {busy ? "Closing…" : "Close protest"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNeedsValue(false);
                setFile(null);
              }}
              className="text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
