// Operations → Verification: properties the county-record check flagged (or
// hasn't finished). Staff see every reason, open the documents, and approve,
// reject (with a note the customer sees) or re-run the check. Filing stays
// held until a property is verified (supabase/pt/property-verification.sql).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getDocumentUrl } from "@/lib/documents";
import {
  listVerificationQueue,
  reviewPropertyVerification,
  verifyProperty,
  VERIFICATION_LABEL,
  type VerificationFlag,
  type VerificationQueueItem,
} from "@/lib/property-verification";
import { VerificationBadge } from "@/components/VerificationNotice";

const SOURCE_LABEL: Record<VerificationFlag["source"], string> = {
  county: "County record",
  file: "File",
  ai: "Corvus AI",
};

function Flags({ flags }: { flags: VerificationFlag[] }) {
  if (!flags.length) return null;
  return (
    <ul className="mt-2 grid gap-1 text-sm">
      {flags.map((f, i) => (
        <li key={i} className="flex gap-2">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.severity === "high" ? "bg-destructive" : "bg-amber-500"}`}
            aria-label={f.severity === "high" ? "Serious" : "Check"}
          />
          <span>
            <span className="font-medium">{SOURCE_LABEL[f.source]}:</span> {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QueueItem({ item, onDone }: { item: VerificationQueueItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function open(path: string) {
    try {
      window.open(await getDocumentUrl(path), "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the document.");
    }
  }

  return (
    <li className="card-elev p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {item.address}
            <VerificationBadge status={item.status} />
          </div>
          <div className="text-xs text-muted-foreground">
            {[
              item.cad,
              item.accountNumber && `Account ${item.accountNumber}`,
              item.ownerName,
              item.userEmail,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {item.checkedAt
            ? `Checked ${new Date(item.checkedAt).toLocaleString()}`
            : "Not checked yet"}
        </div>
      </div>

      <Flags flags={item.flags} />
      {item.status === "rejected" && item.note && (
        <p className="mt-2 text-sm text-muted-foreground">Rejected: {item.note}</p>
      )}

      {item.documents.length > 0 && (
        <div className="mt-3 grid gap-2">
          {item.documents.map((d) => (
            <div key={d.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="truncate font-medium text-accent underline underline-offset-2"
                  onClick={() => open(d.storagePath)}
                >
                  {d.fileName}
                </button>
                <span className="text-xs text-muted-foreground">
                  {VERIFICATION_LABEL[d.status as keyof typeof VERIFICATION_LABEL] ?? d.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-accent text-sm"
          disabled={busy}
          onClick={() =>
            run("Approved — filing is open for this property.", () =>
              reviewPropertyVerification(item.id, "verified"),
            )
          }
        >
          Approve
        </button>
        {rejecting ? (
          <>
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="Why (the customer sees this)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline text-sm text-destructive"
              disabled={busy || !note.trim()}
              onClick={() =>
                run("Rejected.", () => reviewPropertyVerification(item.id, "rejected", note))
              }
            >
              Confirm reject
            </button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-outline text-sm"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        )}
        <button
          type="button"
          className="btn-outline text-sm"
          disabled={busy}
          onClick={() => run("Checked again.", () => verifyProperty(item.id))}
        >
          Re-run check
        </button>
      </div>
    </li>
  );
}

export function VerificationQueue({ onCount }: { onCount?: (n: number) => void }) {
  const [items, setItems] = useState<VerificationQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listVerificationQueue()
      .then((list) => {
        setItems(list);
        onCount?.(list.filter((i) => i.status === "needs_review").length);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the queue."));
  }, [onCount]);
  useEffect(load, [load]);

  if (error) return <p className="mt-4 text-sm text-destructive">{error}</p>;
  if (!items) return <p className="mt-4 text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="mt-4">
      <p className="text-sm text-muted-foreground">
        Every property is checked against the county record, and every uploaded document for signs
        of AI generation or editing. Anything flagged waits here — the customer can keep working,
        but can't sign or file until it's approved.
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing to review.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {items.map((i) => (
            <QueueItem key={i.id} item={i} onDone={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
