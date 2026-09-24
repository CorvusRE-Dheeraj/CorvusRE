import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";

// A small "Undo" link that asks once before doing it — for steps that are easy
// to take by mistake (wrong document, changed my mind). `confirm` says what will
// and won't happen.
export function UndoButton({
  label,
  confirm,
  onUndo,
  successMessage,
  className = "",
}: {
  label: string;
  confirm: string;
  onUndo: () => Promise<void>;
  successMessage: string;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onUndo();
      setAsking(false);
      toast.success(successMessage);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not undo this."));
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={`text-xs text-muted-foreground hover:underline ${className}`}
      >
        ↶ {label}
      </button>
    );
  }
  return (
    <div className={`rounded-md border border-border bg-secondary/40 p-3 text-xs ${className}`}>
      <p>{confirm}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="btn-outline py-1 text-xs disabled:opacity-60"
        >
          {busy ? "Undoing…" : "Yes, undo"}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          disabled={busy}
          className="text-muted-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
