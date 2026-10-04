import { useState } from "react";
import { toast } from "sonner";
import {
  PROTEST_EVIDENCE_DOCUMENT_TYPE,
  deleteDocument,
  getDocumentUrl,
  renameDocument,
  restoreDocument,
  setDocumentType,
  type DocumentRecord,
} from "@/lib/documents";
import { getErrorMessage } from "@/lib/error-message";

const CATEGORY_PREFIX = "Evidence Category: ";

export type EvidenceCategoryOption = { label: string; slug: string };

// One uploaded evidence file with its reorganise controls inline — view,
// rename, move to another evidence category, remove — so fixing a file's
// placement never needs a trip to the Documents tab. Every action goes through
// the same lib/documents helpers the Documents tab uses, and each one calls
// notifyDocumentsChanged(), so both screens stay in sync.
export function EvidenceFileRow({
  doc,
  categories,
}: {
  doc: DocumentRecord;
  categories: EvidenceCategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(doc.fileName);
  const [busy, setBusy] = useState(false);

  const currentSlug = doc.documentType?.startsWith(CATEGORY_PREFIX)
    ? doc.documentType.slice(CATEGORY_PREFIX.length)
    : "";
  const currentLabel = categories.find((c) => c.slug === currentSlug)?.label ?? null;

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  }

  async function view() {
    await run(async () => {
      window.open(await getDocumentUrl(doc.storagePath), "_blank", "noopener,noreferrer");
    }, "Could not open this file.");
  }

  async function saveName() {
    const next = name.trim();
    if (!next || next === doc.fileName) return;
    await run(async () => {
      await renameDocument(doc.id, next);
      toast.success("Renamed.");
    }, "Could not rename this file.");
  }

  async function moveTo(slug: string) {
    await run(async () => {
      await setDocumentType(doc.id, slug ? `${CATEGORY_PREFIX}${slug}` : PROTEST_EVIDENCE_DOCUMENT_TYPE);
      const label = categories.find((c) => c.slug === slug)?.label ?? "Uncategorized";
      toast.success(`Moved to ${label}.`);
    }, "Could not move this file.");
  }

  async function remove() {
    await run(async () => {
      await deleteDocument(doc);
      toast.success("File removed.", {
        action: {
          label: "Undo",
          onClick: () => void restoreDocument(doc.id).catch(() => {}),
        },
      });
    }, "Could not remove this file.");
  }

  return (
    <li className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">
          {doc.fileName}
          {currentLabel && <span className="text-foreground/70"> — {currentLabel}</span>}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 text-accent hover:underline"
        >
          {open ? "Done" : "Manage"}
        </button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveName()}
              aria-label="File name"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              disabled={busy || !name.trim() || name.trim() === doc.fileName}
              className="btn-outline px-2 py-1 text-xs disabled:opacity-50"
            >
              Rename
            </button>
          </div>
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-foreground/70">Move to</span>
            <select
              value={currentSlug}
              disabled={busy}
              onChange={(e) => void moveTo(e.target.value)}
              className="min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void view()}
              disabled={busy}
              className="text-accent hover:underline disabled:opacity-50"
            >
              View file
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="text-destructive hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
