import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  listDocumentsForProperty,
  getCaseSummary,
  PROTEST_STATUS_OPTIONS,
  type AdminProtestRecord,
  type AdminDocumentRecord,
  type CaseSummaryResult,
} from "@/lib/admin";
import type { ProtestStatus } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/CopyButton";

// One protest case row (status, notes, assigned rep, documents, open case) —
// shared by Manage users (under each user) and the Operations case queue.
export function groupProtestsByYear(
  protests: AdminProtestRecord[],
): { year: number | null; records: AdminProtestRecord[] }[] {
  const byYear = new Map<number | null, AdminProtestRecord[]>();
  for (const p of protests) {
    const year = p.protestFilingYear;
    const bucket = byYear.get(year);
    if (bucket) bucket.push(p);
    else byYear.set(year, [p]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    })
    .map(([year, records]) => ({ year, records }));
}

export function ProtestRow({
  record,
  requesterEmail,
  expanded,
  onToggleExpand,
  onStatusChange,
  onNotesChange,
  onAssignedRepChange,
  onOpenCase,
  delayMs = 0,
}: {
  record: AdminProtestRecord;
  requesterEmail: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusChange: (status: ProtestStatus) => void;
  onNotesChange: (notes: string) => Promise<void>;
  onAssignedRepChange: (assignedRepresentative: string) => Promise<void>;
  onOpenCase: () => void;
  delayMs?: number;
}) {
  const [notes, setNotes] = useState(record.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [assignedRep, setAssignedRep] = useState(record.assignedRepresentative ?? "");
  const [savingAssignedRep, setSavingAssignedRep] = useState(false);
  const [documents, setDocuments] = useState<AdminDocumentRecord[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CaseSummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    setNotes(record.notes ?? "");
  }, [record.notes]);

  useEffect(() => {
    setAssignedRep(record.assignedRepresentative ?? "");
  }, [record.assignedRepresentative]);

  useEffect(() => {
    if (!expanded || documents !== null) return;
    listDocumentsForProperty(record.propertyId)
      .then(setDocuments)
      .catch((err) =>
        setDocsError(err instanceof Error ? err.message : "Could not load documents."),
      );
  }, [expanded, documents, record.propertyId]);

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      await onNotesChange(notes);
      toast.success("Notes saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleSaveAssignedRep() {
    setSavingAssignedRep(true);
    try {
      await onAssignedRepChange(assignedRep);
      toast.success("Assigned representative saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the assigned representative.",
      );
    } finally {
      setSavingAssignedRep(false);
    }
  }

  async function handleAiSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const statusLabel =
        PROTEST_STATUS_OPTIONS.find((o) => o.value === record.status)?.label ?? record.status;
      const propertyContext = [
        record.propertyAddress ?? "(property removed)",
        record.propertyCad && `CAD: ${record.propertyCad}`,
        record.accountNumber && `Account #: ${record.accountNumber}`,
        record.taxYear && `Tax year: ${record.taxYear}`,
        record.totalValue != null && `Total value: ${currency(record.totalValue)}`,
        record.landValue != null && `Land value: ${currency(record.landValue)}`,
        record.improvementValue != null &&
          `Improvement value: ${currency(record.improvementValue)}`,
        record.protestDeadline && `Protest deadline: ${record.protestDeadline}`,
      ]
        .filter(Boolean)
        .join("\n");
      const protestContext = [
        `Status: ${statusLabel}`,
        `Requested: ${new Date(record.requestedAt).toLocaleDateString()}`,
        `Requester: ${requesterEmail}`,
        notes.trim() && `Staff notes: ${notes.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");
      const documentsContext = documents?.length
        ? documents
            .map(
              (d) =>
                `- ${d.fileName} (${d.documentType ?? "unknown type"}), uploaded ${new Date(d.uploadedAt).toLocaleDateString()}`,
            )
            .join("\n")
        : "(none uploaded)";
      const result = await getCaseSummary({ propertyContext, protestContext, documentsContext });
      setSummary(result);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Could not generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <div className="card-elev row-hover p-4" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-medium">{record.propertyAddress ?? "Property removed"}</div>
          <div className="text-xs text-muted-foreground">
            {requesterEmail} • Requested {new Date(record.requestedAt).toLocaleDateString()}
            {record.protestDeadline && ` • Deadline ${record.protestDeadline}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={record.status}
            onChange={(e) => onStatusChange(e.target.value as ProtestStatus)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PROTEST_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button onClick={onToggleExpand} className="btn-outline text-sm">
            {expanded ? "Hide details" : "View details"}
          </button>
          <button onClick={onOpenCase} className="btn-outline text-sm">
            Case Progress
          </button>
        </div>
      </div>

      {/* CSS grid-rows collapse: the wrapper's row size animates between 0fr
          and 1fr instead of the content mounting/unmounting instantly, so
          both opening AND closing are smooth. Content stays mounted (the
          lazy document fetch above is still gated on `expanded` itself, not
          on JSX mount) and is just clipped to zero height when collapsed. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-4 border-t border-border pt-4 grid gap-4">
            <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              {record.propertyCad && <div>CAD: {record.propertyCad}</div>}
              {record.accountNumber && (
                <div className="inline-flex items-center gap-1">
                  Account #: {record.accountNumber}
                  <CopyButton value={record.accountNumber} label="Account number copied" />
                </div>
              )}
              {record.taxYear && <div>Tax year: {record.taxYear}</div>}
              {record.totalValue != null && <div>Total value: {currency(record.totalValue)}</div>}
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Documents</div>
              {docsError ? (
                <p className="text-sm text-destructive">{docsError}</p>
              ) : documents === null ? (
                <Skeleton className="h-4 w-40" />
              ) : documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <ul className="text-sm text-muted-foreground grid gap-1">
                  {documents.map((d) => (
                    <li key={d.id}>
                      {d.fileName} — {d.documentType ?? "unknown type"} •{" "}
                      {new Date(d.uploadedAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Staff Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Internal notes about this case…"
              />
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="btn-outline text-sm mt-2 disabled:opacity-60"
              >
                {savingNotes ? "Saving…" : "Save Notes"}
              </button>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Assigned Representative</div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Shown to the customer once set — who at CorvusPT is actually handling this case.
              </p>
              <input
                value={assignedRep}
                onChange={(e) => setAssignedRep(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="e.g. Jane Doe, jane@corvuspt.com, (469) 555-0100"
              />
              <button
                onClick={handleSaveAssignedRep}
                disabled={savingAssignedRep}
                className="btn-outline text-sm mt-2 disabled:opacity-60"
              >
                {savingAssignedRep ? "Saving…" : "Save Representative"}
              </button>
            </div>

            <div>
              <button
                onClick={handleAiSummary}
                disabled={summaryLoading}
                className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
              >
                {summaryLoading ? "Generating…" : "AI Case Summary"}
              </button>
              {summaryError && <p className="mt-2 text-sm text-destructive">{summaryError}</p>}
              {summary && (
                <div className="mt-3 rounded-md bg-secondary/50 p-3 text-sm grid gap-2">
                  <p>{summary.summary}</p>
                  {summary.nextAction && (
                    <p>
                      <span className="font-medium">Next action:</span> {summary.nextAction}
                    </p>
                  )}
                  {summary.evidenceGaps.length > 0 && (
                    <div>
                      <span className="font-medium">Evidence gaps:</span>
                      <ul className="list-disc list-inside">
                        {summary.evidenceGaps.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
