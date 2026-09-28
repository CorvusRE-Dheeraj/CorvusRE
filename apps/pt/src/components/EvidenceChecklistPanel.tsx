import { useEffect, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  getModuleAnalysis,
  type EvidenceItem,
  type ModuleAnalysisInput,
} from "@/lib/ai-report-modules";
import { categorizeEvidenceUploads, evidenceItemSlug } from "@/lib/evidence-categorize";
import {
  uploadDocument,
  listDocuments,
  PROTEST_EVIDENCE_DOCUMENT_TYPE,
  type DocumentRecord,
} from "@/lib/documents";
import {
  hashModuleInput,
  getCachedModuleResult,
  saveModuleResult,
  MODEL_TAG,
} from "@/lib/module-results-cache";
import type { PropertyRecord } from "@/lib/properties";
// Reused straight from the AI Report page's own Module 8 detail view — the
// exact same per-item row (expand, upload, existing-files list), not a
// second copy that could drift from it.
import { EvidenceCategoryRow } from "@/routes/ai-report";

// The genuine Module 8 checklist + AI-categorized upload, embedded inline
// on View Case (CaseDetailModal's EvidenceStatusCard / CorvusGuidancePanel)
// instead of only living on the AI Report page — explicit product direction
// 2026-09: uploading evidence shouldn't force navigating away from the case
// and back. Calls the same evidence module + the same module_results cache
// ai-report.tsx's loadModule() uses (see hashModuleInput/getCachedModuleResult/
// saveModuleResult), so a checklist computed here and one computed on the AI
// Report page for the same property agree — same cached row either way — and
// uploadDocument()'s own notifyDocumentsChanged() already refreshes every
// other open "Evidence" summary (useDocumentsVersion) once this panel's
// upload also re-saves the cache below.
//
// Deliberately NOT included here (out of scope for this pass — real
// features of their own, not what blocks "upload without leaving the
// page"): Auto-source evidence (live CAD/GIS re-pull), the category/priority
// grouping toggle (always priority here), "Analyze My Evidence" (a second,
// separate AI narrative pass over the uploaded files), and the evidence
// packet PDF download. All of those stay AI-Report-page-only for now.
export function EvidenceChecklistPanel({
  property,
  userId,
}: {
  property: PropertyRecord;
  userId: string;
}) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  async function loadDocs(): Promise<DocumentRecord[]> {
    const all = await listDocuments(userId);
    const forProperty = all.filter((d) => d.propertyId === property.id && !d.deletedAt);
    setDocs(forProperty);
    return forProperty;
  }

  async function loadChecklist(forceRegenerate: boolean, currentDocs: DocumentRecord[]) {
    const onFile = currentDocs.filter(
      (d) =>
        d.useAsEvidence === true ||
        (d.useAsEvidence !== false &&
          (d.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE ||
            d.documentType?.startsWith("Evidence Category: "))),
    );
    const input: ModuleAnalysisInput = {
      address: property.address ?? undefined,
      cad: property.cad ?? undefined,
      propertyType: property.propertyType ?? undefined,
      landValue: property.landValue ?? undefined,
      improvementValue: property.improvementValue ?? undefined,
      totalValue: property.totalValue ?? undefined,
      taxYear: property.taxYear ?? undefined,
      evidenceOnFile:
        onFile.length > 0
          ? onFile.slice(0, 20).map((d) => ({
              name: d.fileName,
              category: d.category ?? null,
              aiNotes: d.aiNotes ?? null,
              verdict: d.aiVerdict ?? null,
            }))
          : undefined,
    };
    const inputHash = await hashModuleInput("evidence", input);
    if (!forceRegenerate) {
      const hit = await getCachedModuleResult(property.id, "evidence").catch(() => null);
      if (hit && hit.inputHash === inputHash) {
        setItems((hit.result as { items: EvidenceItem[] }).items ?? []);
        return;
      }
    }
    const data = await getModuleAnalysis("evidence", input);
    setItems(data.items);
    saveModuleResult(userId, property.id, "evidence", inputHash, MODEL_TAG, data).catch((e) =>
      console.error("evidence module cache write failed:", e),
    );
  }

  async function refresh(forceRegenerate = false) {
    setLoading(true);
    setError(null);
    try {
      const currentDocs = await loadDocs();
      await loadChecklist(forceRegenerate, currentDocs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the evidence checklist.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

  async function handleUploadEvidence(files: File[], documentType: string) {
    setUploading(true);
    try {
      for (const file of files) {
        await uploadDocument(userId, property.id, file, documentType);
      }
      await refresh(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload this file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleBulkUpload(files: File[]) {
    if (!items) return;
    setCategorizing(true);
    try {
      const categorized = await categorizeEvidenceUploads(
        items.map((it) => it.item),
        files,
      ).catch(() => []);
      const groups = new Map<string, File[]>();
      for (const file of files) {
        const matched = categorized.find((c) => c.fileName === file.name)?.matchedItem ?? null;
        const key = matched
          ? `Evidence Category: ${evidenceItemSlug(matched)}`
          : PROTEST_EVIDENCE_DOCUMENT_TYPE;
        const group = groups.get(key);
        if (group) group.push(file);
        else groups.set(key, [file]);
      }
      setUploading(true);
      for (const [documentType, groupFiles] of groups) {
        for (const file of groupFiles) {
          await uploadDocument(userId, property.id, file, documentType);
        }
      }
      await refresh(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload these files.");
    } finally {
      setCategorizing(false);
      setUploading(false);
    }
  }

  if (loading && !items) {
    return <p className="text-xs text-muted-foreground">Loading your evidence checklist…</p>;
  }
  if (error) {
    return (
      <div className="text-xs text-destructive">
        {error}{" "}
        <button type="button" onClick={() => void refresh()} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (!items) return null;

  const evPriority = (it: EvidenceItem) => it.priority ?? "Supporting";
  const needsActionItems = items.filter((i) => i.status === "Missing" && evPriority(i) === "Critical");
  const onFileItems = items.filter((i) => i.status !== "Missing");
  const strengthenItems = items.filter(
    (i) => i.status === "Missing" && evPriority(i) !== "Critical",
  );
  const categories = items.map((x) => ({ label: x.item, slug: evidenceItemSlug(x.item) }));

  const renderRow = (it: EvidenceItem) => {
    const slug = evidenceItemSlug(it.item);
    const uploadedForItem = docs.filter((doc) => doc.documentType === `Evidence Category: ${slug}`);
    return (
      <EvidenceCategoryRow
        key={it.item}
        it={it}
        uploadedDocs={uploadedForItem}
        categories={categories}
        expanded={expandedItem === it.item}
        onToggleExpand={() => setExpandedItem((prev) => (prev === it.item ? null : it.item))}
        uploadingEvidence={uploading}
        onUploadEvidence={(files) => handleUploadEvidence(files, `Evidence Category: ${slug}`)}
      />
    );
  };

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Evidence checklist
        </span>
        <div className="flex items-center gap-2">
          <label
            className={`btn-accent inline-flex cursor-pointer items-center gap-1.5 text-xs py-1.5 ${
              categorizing || uploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            {categorizing ? "Reading documents…" : uploading ? "Uploading…" : "Upload Evidence"}
            <input
              type="file"
              accept="image/*,.pdf"
              multiple
              disabled={categorizing || uploading}
              className="hidden"
              onChange={(e) => {
                const sel = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (sel.length > 0) void handleBulkUpload(sel);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={loading}
            title="Re-check against what's on file"
            className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {needsActionItems.length > 0 && (
        <div className="grid gap-2 rounded-md bg-destructive/5 p-2">
          <div className="text-xs font-bold uppercase tracking-wide text-destructive">
            Needs your action — {needsActionItems.length} critical item
            {needsActionItems.length === 1 ? "" : "s"} missing
          </div>
          {needsActionItems.map(renderRow)}
        </div>
      )}
      {onFileItems.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            On file &amp; verified — {onFileItems.length}
          </div>
          {onFileItems.map(renderRow)}
        </div>
      )}
      {strengthenItems.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Strengthen your case (optional) — {strengthenItems.length}
          </div>
          {strengthenItems.map(renderRow)}
        </div>
      )}
    </div>
  );
}
