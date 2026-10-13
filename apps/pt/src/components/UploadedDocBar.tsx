import { useState } from "react";
import { FileText, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";

// Shown under any document uploaded to a case: what was uploaded, plus
// Replace (pick the right file — it takes the old one's place) and Remove
// (take the upload back entirely, asked once first). For uploads made by
// mistake.
export function UploadedDocBar({
  label,
  fileName,
  accept = "image/*,.pdf",
  onReplace,
  onRemove,
  removeConfirm,
  busy = false,
}: {
  label: string;
  fileName?: string | null;
  accept?: string;
  onReplace?: (file: File) => void | Promise<void>;
  onRemove: () => Promise<void>;
  // What Remove undoes, in a sentence.
  removeConfirm: string;
  busy?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await onRemove();
      setAsking(false);
      toast.success(`${label} removed — you can upload the right one now.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not remove this upload."));
    } finally {
      setRemoving(false);
    }
  }

  const disabled = busy || removing;
  return (
    <div className="mt-2 rounded-md border border-border bg-secondary/30 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{label}</span>
          {fileName && <span className="truncate text-muted-foreground">· {fileName}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {onReplace && (
            <label
              className={`btn-outline inline-flex cursor-pointer items-center gap-1 px-2.5 py-1 text-xs ${disabled ? "pointer-events-none opacity-60" : ""}`}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" /> Replace
              <input
                type="file"
                accept={accept}
                className="hidden"
                disabled={disabled}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onReplace(f);
                }}
              />
            </label>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAsking(true)}
            className="btn-outline inline-flex items-center gap-1 px-2.5 py-1 text-xs text-destructive disabled:opacity-60"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" /> Remove
          </button>
        </span>
      </div>
      {asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="text-muted-foreground">{removeConfirm}</span>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={removing}
            className="rounded-md bg-destructive px-2.5 py-1 font-semibold text-destructive-foreground disabled:opacity-60"
          >
            {removing ? "Removing…" : "Yes, remove"}
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="text-muted-foreground hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
